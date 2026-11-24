import { normalizePath, type GraphNode } from '@flowatlas/core';
import { deadJudge, type GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { sampledIn } from '../query/observed.js';
import { rankMatches } from '../query/names.js';
import { MAX_NEXT, nextFor, withNext, withoutShown, withTraceFor } from '../query/next.js';
import { declaredBy, isDeclared } from '../query/declared.js';
import { requestsOf } from '../query/requests.js';
import { byWords, wordsLeft, WORDS_PAGE } from '../query/words.js';
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

/** The reach of a way in no caller joins that is not judged dead, though it may be (P381): a call read in part, one a segment off. */
const UNCALLED_MAYBE: ReadonlySet<Reach> = new Set(['maybe', 'unreached']);

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
  // Asked with `in`, each row also says who calls it (P379): how many callers, and the first.
  entries: z.array(reachedNodeOutput.extend({ callers: z.number().optional(), caller: z.string().optional() })),
  declaredBy: z.string().optional(),
  ...pageOutput,
  ...completeOutput,
  note: z.string().optional(),
  next: nextOutput,
};

/** What find_symbol answers: one page of matches, best first; found by words (P383), each with the words it holds. */
export const findSymbolOutput = {
  matches: z.array(matchedNodeOutput.extend({ matched: z.array(z.string()).optional() })).optional(),
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
  const args = { query, types: input.types, service: input.service, detail: input.detail, maxNodes };
  // No name holds the query: the names holding its words (P383), ranked, and never said complete.
  if (ranked.length === 0) return findByWords(db, input, query, reader, args);

  const { items, total, truncated, nextOffset } = truncate(ranked, maxNodes, input.offset);
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

/**
 * find_symbol by the words of the query (P383), where no name holds it as
 * written: "order cancel" and "cancelOrder" find `OrdersClient.cancel` and the
 * cancel route. Ranked, so never `complete` (`left` says `fuzzy`); an empty answer only
 * where no name holds any of its words.
 */
const findByWords = (db: GraphDb, input: FindAsked, query: string, reader: ReachReader, args: Record<string, unknown>): object => {
  const { detail, maxNodes, note } = bound(input);
  const types = input.types === undefined || input.types.length === 0 ? undefined : new Set(input.types);
  const found = byWords(db, query, {
    ...(types === undefined ? {} : { admits: (node: GraphNode) => types.has(node.type) }),
    withTypes: false,
    service: input.service,
    limit: Math.min(maxNodes, WORDS_PAGE),
    offset: input.offset,
    detail,
    reader,
  });
  if (found.rows.length === 0) return { matches: [], total: 0, complete: true, ...(note === undefined ? {} : { note }) };
  const nextOffset = found.total > input.offset + found.rows.length ? input.offset + found.rows.length : undefined;
  const rows = found.rows.map((row) => {
    const node = db.node(row.id);
    return node === undefined ? row : { ...row, ...requestsOf(db, node) };
  });
  return withNext(
    {
      matches: rows,
      total: found.total,
      ...(nextOffset === undefined ? {} : { nextOffset }),
      ...completeOf([wordsLeft(found, found.rows.length, input.offset), ...reader.left()]),
      ...(note === undefined ? {} : { note }),
    },
    pagedNext({ tool: 'find_symbol', args, nextOffset }, withoutShown(nextFor(found.first), rows)),
  );
};

export const registerEntries = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'list_entries',
    {
      title: 'List entry points',
      description:
        'Ways in, of any `kind`; `in` a class, method or file lists its own, with `reach`.',
      inputSchema: {
        service: serviceInput,
        kind: z.enum(ENTRY_KINDS).optional(),
        pathPrefix: z.string().optional().describe('routes under this path'),
        in: z.string().optional(),
        reach: z.enum(REACHES as [Reach, ...Reach[]]).optional(),
        called: z.boolean().optional(),
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
        const unjudged = input.reach === undefined && input.called === undefined && declared === undefined;
        const judge = unjudged ? undefined : deadJudge(db, db.report(), deadOptionsOf(ctx.handle));
        const judged = new Map<string, ReturnType<NonNullable<typeof judge>>>();
        const verdictOf = (entry: GraphNode): ReturnType<NonNullable<typeof judge>> => {
          if (!judged.has(entry.id)) judged.set(entry.id, judge?.(entry.id));
          return judged.get(entry.id);
        };
        const reachOf = (entry: GraphNode): Reach | undefined => {
          const answer = verdictOf(entry);
          return answer === undefined ? undefined : reachOfVerdict(entry, answer);
        };
        // Who calls it, as dead on a class says it (P375): how many callers, none said as 0 (P381), and the first (P379).
        const callersOf = (entry: GraphNode): object => {
          const evidence = verdictOf(entry)?.evidence ?? {};
          const { callers, caller } = evidence as { callers?: unknown; caller?: unknown };
          return {
            callers: typeof callers === 'number' ? callers : 0,
            ...(typeof caller === 'string' && caller !== '' ? { caller } : {}),
          };
        };
        // The fact a verdict rests on (P381): a caller in the project joins it - a request, a link - or none does.
        const isCalled = (entry: GraphNode): boolean => {
          const { callers, links } = (verdictOf(entry)?.evidence ?? {}) as { callers?: unknown; links?: unknown };
          return (typeof callers === 'number' && callers > 0) || (typeof links === 'number' && links > 0);
        };
        const inDeclared = declared === undefined ? undefined : new Set(declared.entries.map((entry) => entry.id));
        const filtered = db
          .nodesByType('entry', input.kind)
          .filter(inService(input.service))
          .filter((entry) => inDeclared === undefined || inDeclared.has(entry.id))
          .filter((entry) => {
            if (prefix === undefined) return true;
            const path = normalizePath(String(entry.meta?.['path'] ?? ''));
            return path === prefix || path.startsWith(prefix === '/' ? '/' : `${prefix}/`);
          })
          // Judged last, so only the rows the other filters kept are judged.
          .filter((entry) => input.called === undefined || isCalled(entry) === input.called);
        const all = filtered.filter((entry) => input.reach === undefined || reachOf(entry) === input.reach).sort(inReadingOrder);
        // Asked for the dead, the ways in no caller joins either that are judged a maybe (a request read in part could
        // reach it, one a segment off) are no less uncalled (P381): counted, and `called: false` lists every one.
        const uncalledElse =
          input.reach !== 'dead' || input.called !== undefined
            ? 0
            : filtered.filter((entry) => !isCalled(entry) && UNCALLED_MAYBE.has(reachOf(entry) ?? 'alive')).length;

        const { items, total, truncated, nextOffset } = truncate(all, maxNodes, input.offset);
        const args = {
          service: input.service,
          kind: input.kind,
          pathPrefix: input.pathPrefix,
          in: input.in,
          reach: input.reach,
          called: input.called,
          detail: input.detail,
          maxNodes,
        };
        const everyUncalled = callOf('list_entries', { ...args, reach: undefined, called: false, maxNodes: undefined, detail: undefined });
        // Asked about one class's ways in, each row says whether it runs and who calls it (P379); asked for one reach,
        // the call said whether.
        const withReach = (entry: GraphNode): object => {
          const row = projectDetail(entry, detail);
          if (declared === undefined || detail < 1) return row;
          const reach = input.reach === undefined ? reachOf(entry) : undefined;
          return { ...row, ...(reach === undefined ? {} : { reach }), ...callersOf(entry) };
        };
        const owner = declared === undefined ? undefined : (declared.node?.id ?? declared.file);
        // Every way in a class or file declares, judged with why, one call away (P375): what a row's reach rests on.
        const verdicts = owner === undefined || items.length === 0 ? [] : [callOf('dead', { id: owner })];
        return withNext(
          {
            ...(owner === undefined ? {} : { declaredBy: owner }),
            entries: items.map(withReach),
            total,
            ...(nextOffset === undefined ? {} : { truncated, nextOffset }),
            ...completeOf([
              pageLeft(total, items.length, input.offset, nextOffset),
              uncalledElse > 0 &&
                `uncalled: ${uncalledElse} more way${uncalledElse === 1 ? ' in no caller joins is' : 's in no caller joins are'} judged maybe, not dead: called: false lists every one`,
            ]),
            ...(note === undefined ? {} : { note }),
          },
          pagedNext(
            { tool: 'list_entries', args, nextOffset },
            [...new Set([...(uncalledElse > 0 ? [everyUncalled] : []), ...verdicts, ...withTraceFor(nextFor(items[0]), items[0], sampledIn(ctx.handle.path))])].slice(
              0,
              MAX_NEXT,
            ),
          ),
        );
      }),
  );

  server.registerTool(
    'find_symbol',
    {
      title: 'Find a symbol',
      description: 'Any node by part of a name or id, words or initials ("ocs": OrderCreationService).',
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
