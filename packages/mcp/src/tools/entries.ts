import { normalizePath, type GraphNode } from '@flowatlas/core';
import { deadJudge, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { sampledIn } from '../query/observed.js';
import { rankMatches } from '../query/names.js';
import { nextFor, withNext, withoutShown, withTraceFor } from '../query/next.js';
import { declaredBy, isDeclared } from '../query/declared.js';
import { requestsOf } from '../query/requests.js';
import { deadOptionsOf, reachOfVerdict, reachReader, REACHES, type Reach, type ReachReader } from '../query/ways-in.js';
import {
  answerEach,
  answersOutput,
  askedOf,
  bound,
  callOf,
  commonInput,
  completeOf,
  completeOutput,
  inService,
  matchedNodeOutput,
  nextOutput,
  nodeOutput,
  pagedNext,
  pageInput,
  pageLeft,
  pageOutput,
  reachedNodeOutput,
  READ_ONLY,
  serviceInput,
  severalInput,
  withDb,
  type ToolContext,
} from './common.js';

/** Kinds of entry the model knows about, for filtering. */
const ENTRY_KINDS = [
  'http',
  'bot_command',
  'bot_callback',
  'bot_event',
  'scene_step',
  'event',
  'rpc',
  'cron',
  'invoke',
  'workflow',
  'task',
  'screen',
] as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Service, then kind, then the key it is registered under. */
const inReadingOrder = (a: GraphNode, b: GraphNode): number =>
  cmp(a.repo, b.repo) || cmp(a.kind ?? '', b.kind ?? '') || cmp(a.label, b.label);

/**
 * Fuzzy match and near names live with the resolver (`query/names.ts`), so a
 * name an error suggests is ranked the way every lookup ranks it (P94).
 */
export { nearNames, rankMatches, type Ranked } from '../query/names.js';

/** What list_entries answers: one page of entries, and how many there are. */
export const listEntriesOutput = {
  entries: z.array(reachedNodeOutput),
  declaredBy: z.string().optional(),
  ...pageOutput,
  ...completeOutput,
  note: z.string().optional(),
  next: nextOutput,
};

/** What find_symbol answers: one page of matches, best first. */
export const findSymbolOutput = {
  matches: z.array(matchedNodeOutput).optional(),
  total: pageOutput.total.optional(),
  nextOffset: pageOutput.nextOffset,
  truncated: pageOutput.truncated,
  note: z.string().optional(),
  answers: answersOutput,
  ...completeOutput,
  next: nextOutput,
};

/** What find_symbol was asked, less the query, which each answer of several takes in turn. */
interface FindAsked {
  types?: string[] | undefined;
  service?: string | undefined;
  detail: number;
  maxNodes: number;
  offset: number;
}

/** One query's matches, best first, each row with whether it runs and where it is reached from (P364). */
const findOne = (db: GraphDb, input: FindAsked, query: string, reader: ReachReader): object => {
  if (query.trim().length < 2) return { matches: [], note: 'query too short' };
  const { detail, maxNodes, note } = bound(input);

  const pool = db.search(query, {
    ...(input.types === undefined ? {} : { types: input.types }),
    limit: Math.max((input.offset + maxNodes) * 4, 200),
  });
  const wider = pool.length > 0 ? pool : db.nodesByType('method');
  const ranked = rankMatches(wider.filter(inService(input.service)), query);

  const { items, total, truncated, nextOffset } = truncate(ranked, maxNodes, input.offset);
  const args = { query, types: input.types, service: input.service, detail: input.detail, maxNodes };
  // A method that sends requests says where they land (P377).
  const rows = items.map((match) => ({ ...reader.annotate(projectDetail(match.node, detail)), ...requestsOf(db, match.node) }));
  return withNext(
    {
      matches: rows,
      total,
      ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
      ...completeOf([pageLeft(total, items.length, input.offset, nextOffset), ...reader.left()]),
      ...(note === undefined ? {} : { note }),
    },
    pagedNext({ tool: 'find_symbol', args, nextOffset }, withoutShown(nextFor(items[0]?.node), rows)),
  );
};

export const registerEntries = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'list_entries',
    {
      title: 'List entry points',
      description:
        'Ways in: routes, procedures, screens, bot commands, jobs, handlers; `in` a class, method or file lists its own, with `reach`.',
      inputSchema: {
        service: serviceInput,
        kind: z.enum(ENTRY_KINDS).optional(),
        pathPrefix: z.string().optional().describe('routes under this path'),
        in: z.string().optional(),
        reach: z.enum(REACHES as [Reach, ...Reach[]]).optional(),
        ...commonInput,
        ...pageInput,
      },
      outputSchema: listEntriesOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const { detail, maxNodes, note } = bound(input);
        const prefix = input.pathPrefix === undefined ? undefined : normalizePath(input.pathPrefix);
        // The ways in one class, method or file declares (P375), rather than every one under a path.
        const declared = input.in === undefined ? undefined : declaredBy(db, input.in, input.service);
        if (declared !== undefined && !isDeclared(declared)) {
          return declared.candidates.length === 0
            ? { error: `no class, method or file matches ${JSON.stringify(input.in)}`, next: [callOf('find_symbol', { query: input.in })] }
            : withNext(
                { candidates: declared.candidates.map((node) => projectDetail(node, 1)) },
                declared.candidates.slice(0, 2).map((node) => callOf('list_entries', { in: node.id })),
              );
        }
        const judge = input.reach === undefined && declared === undefined ? undefined : deadJudge(db, db.report(), deadOptionsOf(ctx.handle));
        const reachOf = (entry: GraphNode): Reach | undefined => {
          const answer = judge?.(entry.id);
          return answer === undefined ? undefined : reachOfVerdict(entry, answer);
        };
        const inDeclared = declared === undefined ? undefined : new Set(declared.entries.map((entry) => entry.id));
        const all = db
          .nodesByType('entry', input.kind)
          .filter(inService(input.service))
          .filter((entry) => inDeclared === undefined || inDeclared.has(entry.id))
          .filter((entry) => {
            if (prefix === undefined) return true;
            const path = normalizePath(String(entry.meta?.['path'] ?? ''));
            return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`);
          })
          // Judged last, so only the rows the other filters kept are judged.
          .filter((entry) => input.reach === undefined || reachOf(entry) === input.reach)
          .sort(inReadingOrder);

        const { items, total, truncated, nextOffset } = truncate(all, maxNodes, input.offset);
        const args = {
          service: input.service,
          kind: input.kind,
          pathPrefix: input.pathPrefix,
          in: input.in,
          reach: input.reach,
          detail: input.detail,
          maxNodes,
        };
        // Asked about one class's ways in, each row says whether it runs; asked for one reach, the call said it.
        const withReach = (entry: GraphNode): object => {
          const row = projectDetail(entry, detail);
          const reach = declared === undefined || input.reach !== undefined || detail < 1 ? undefined : reachOf(entry);
          return reach === undefined ? row : { ...row, reach };
        };
        const owner = declared === undefined ? undefined : (declared.node?.id ?? declared.file);
        return withNext(
          {
            ...(owner === undefined ? {} : { declaredBy: owner }),
            entries: items.map(withReach),
            total,
            ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
            ...completeOf([pageLeft(total, items.length, input.offset, nextOffset)]),
            ...(note === undefined ? {} : { note }),
          },
          pagedNext({ tool: 'list_entries', args, nextOffset }, withTraceFor(nextFor(items[0]), items[0], sampledIn(ctx.handle.path))),
        );
      }),
  );

  server.registerTool(
    'find_symbol',
    {
      title: 'Find a symbol',
      description: 'Any node by part of its name or id, or initials ("ocs": OrderCreationService).',
      inputSchema: {
        query: z.string().optional(),
        queries: severalInput(),
        types: z.array(z.string()).optional().describe('node types'),
        service: serviceInput,
        ...commonInput,
        ...pageInput,
      },
      outputSchema: findSymbolOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const asked = askedOf(input.query, input.queries);
        if (asked.length === 0) return { error: 'ask with query or queries' };
        const reader = reachReader(db, ctx.handle, bound(input).detail);
        if (asked.length === 1) return findOne(db, input, asked[0]!, reader);
        return answerEach('query', asked, (query) => findOne(db, input, query, reader));
      }),
  );
};
