import {
  deadChannels,
  deadEntries,
  deadMethods,
  deadProviders,
  deadVerdict,
  EXTERNALLY_TRIGGERED,
  VERDICT_ORDER,
  type DeadEvidence,
  type DeadOptions,
  type DeadVerdict,
  type GraphDb,
} from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail, truncate } from '../query/detail.js';
import { isResolved, resolveSymbol } from '../query/entry-ref.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import type { DbHandle } from '../query/db.js';
import { loadObserved } from '../query/observed.js';
import {
  callOf,
  commonInput,
  nextOutput,
  nodeOutput,
  pagedNext,
  pageInput,
  pageOutput,
  READ_ONLY,
  serviceInput,
  withDb,
  type ToolContext,
} from './common.js';

/** What `dead` lists, the CLI's `--kind` less `fields` (which needs the contracts checker). */
export const DEAD_KINDS = ['entries', 'channels', 'providers', 'methods'] as const;
export type DeadKind = (typeof DEAD_KINDS)[number];

/** Listed without `kind`: methods only when asked, since a used class's uncalled methods are many and each is `likely-dead`. */
const LISTED_BY_DEFAULT: readonly DeadKind[] = ['entries', 'channels', 'providers'];

/** The type of node each kind lists, which each row says it is. */
const TYPE_OF: Readonly<Record<DeadKind, string>> = { entries: 'entry', channels: 'channel', providers: 'provider', methods: 'method' };

/**
 * The rules the CLI's `dead` reads from the configuration, read the same way
 * so the two agree, and the observed file beside the database when there is
 * one: traffic is evidence for every verdict (P110), over all it holds.
 */
export const deadOptionsOf = (handle: Pick<DbHandle, 'config'> & { path?: string }, service?: string): DeadOptions => {
  const publicRoutes = handle.config?.doctor?.publicRoutes ?? [];
  const infrastructure = handle.config?.dead?.infrastructure;
  const observed = handle.path === undefined ? undefined : loadObserved(handle.path);
  return {
    ...(service === undefined ? {} : { service }),
    ...(publicRoutes.length === 0 ? {} : { publicRoutes }),
    ...(infrastructure === undefined ? {} : { infrastructure }),
    ...(observed === undefined ? {} : { observed }),
  };
};

const locOf = (item: { file?: string; line?: number }): string | undefined =>
  item.file === undefined ? undefined : item.line === undefined ? item.file : `${item.file}:${item.line}`;

/** A place as the wire says it: `loc`, not `file` and `line`. */
const withLoc = <T extends { file?: string; line?: number }>(item: T): Omit<T, 'file' | 'line'> & { loc?: string } => {
  const { file: _file, line: _line, ...rest } = item;
  const loc = locOf(item);
  return { ...rest, ...(loc === undefined ? {} : { loc }) };
};

/** The evidence as it goes out: each call's place as `loc`. */
const wireEvidence = (evidence: DeadEvidence): Record<string, unknown> => ({
  ...evidence,
  ...(evidence.couldHit === undefined ? {} : { couldHit: evidence.couldHit.map(withLoc) }),
  ...(evidence.oneOff === undefined ? {} : { oneOff: evidence.oneOff.map(withLoc) }),
});

/** One row of a `dead` list. */
interface DeadRow {
  id: string;
  type: string;
  verdict: DeadVerdict;
  reason: string;
  service?: string;
  loc?: string;
  /** For a route that is not `actionable` (P91): what it is. */
  class?: string;
  evidence?: Record<string, unknown>;
}

const rowOf = (
  type: string,
  item: { id: string; verdict: DeadVerdict; reason: string; service?: string; file?: string; line?: number; evidence?: DeadEvidence; class?: string },
): DeadRow => {
  const loc = locOf(item);
  return {
    id: item.id,
    type,
    verdict: item.verdict,
    reason: item.reason,
    ...(item.service === undefined || item.service === '' ? {} : { service: item.service }),
    ...(loc === undefined ? {} : { loc }),
    ...(item.class === undefined || item.class === 'actionable' ? {} : { class: item.class }),
    ...(item.evidence === undefined || Object.keys(item.evidence).length === 0 ? {} : { evidence: wireEvidence(item.evidence) }),
  };
};

/**
 * Every row of the kinds asked for, verdict first (the claims to act on at the
 * top), then by kind in `DEAD_KINDS` order, then in the order the analysis
 * lists them. The same functions `flowatlas dead` lists by (D1).
 */
export const deadRows = (db: GraphDb, options: DeadOptions, kinds: readonly DeadKind[]): DeadRow[] => {
  const report = db.report();
  const LISTS: Readonly<Record<DeadKind, () => DeadRow[]>> = {
    entries: () => deadEntries(db, report, options).map((row) => rowOf(TYPE_OF.entries, row)),
    channels: () =>
      deadChannels(db, report, options).map((row) =>
        rowOf(TYPE_OF.channels, { ...row, service: [...row.producers, ...row.consumers][0] ?? '' }),
      ),
    providers: () => deadProviders(db, options).map((row) => rowOf(TYPE_OF.providers, row)),
    methods: () => deadMethods(db, options).map((row) => rowOf(TYPE_OF.methods, row)),
  };
  const rows = kinds.flatMap((kind, kindAt) => LISTS[kind]().map((row, at) => ({ row, kindAt, at })));
  return rows
    .sort((a, b) => VERDICT_ORDER[a.row.verdict] - VERDICT_ORDER[b.row.verdict] || a.kindAt - b.kindAt || a.at - b.at)
    .map((item) => item.row);
};

/** The calls that show why a verdict is what it is: the call that could hit it, the one a segment off, or who reaches it. */
const verdictNext = (id: string, verdict: DeadVerdict, evidence: DeadEvidence, service: string | undefined): string[] => [
  ...(evidence.couldHit ?? []).slice(0, 1).map((miss) => callOf('get_source', { symbol: miss.call })),
  ...(evidence.oneOff ?? []).slice(0, 1).map((off) => callOf('get_source', { symbol: off.call })),
  ...(verdict === 'alive' ? [callOf('who_calls', { symbol: id })] : [callOf('get_source', { symbol: id })]),
  // A caller the reading missed hides behind a gap: the service's are where to look.
  ...(verdict === 'alive' || service === undefined ? [] : [callOf('cant_follow', { service })]),
];

const evidenceOutput = z.record(z.string(), z.unknown());

const deadRowOutput = z.object({
  id: z.string(),
  type: z.string(),
  verdict: z.enum(['dead', 'likely-dead', 'unknown', 'alive']),
  reason: z.string(),
  service: z.string().optional(),
  loc: z.string().optional(),
  class: z.string().optional(),
  evidence: evidenceOutput.optional(),
});

/** What dead answers: one node's verdict, a page of rows, or the nodes a name could mean. */
export const deadOutput = {
  id: z.string().optional(),
  type: z.string().optional(),
  kind: z.string().optional(),
  service: z.string().optional(),
  loc: z.string().optional(),
  verdict: z.enum(['dead', 'likely-dead', 'unknown', 'alive']).optional(),
  reason: z.string().optional(),
  class: z.string().optional(),
  role: z.string().optional(),
  evidence: evidenceOutput.optional(),
  alsoAnswers: z.array(z.string()).optional(),
  rows: z.array(deadRowOutput).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  excludedEntryKinds: z.array(z.string()).optional(),
  ...pageOutput,
  total: z.number().optional(),
  candidates: z.array(nodeOutput).optional(),
  next: nextOutput,
};

/** One node, by any name a tool takes; a channel by its bare name too. */
const answerOne = (db: GraphDb, ctx: ToolContext, ref: string): object => {
  const channel = db.node(`channel:${ref.trim()}`);
  const found = channel === undefined ? resolveSymbol(db, ref) : { id: channel.id, node: channel };
  if (!isResolved(found)) {
    if (found.candidates.length === 0) {
      const near = nearNames(db.search(ref.trim(), { limit: 200 }), ref.trim(), 5);
      return {
        error: `nothing matches ${JSON.stringify(ref)}`,
        suggestions: near.map((node) => projectDetail(node, 1)),
        next: near.slice(0, MAX_NEXT).map((node) => callOf('dead', { id: node.id })),
      };
    }
    return withNext(
      { candidates: found.candidates.map((node) => projectDetail(node, 1)) },
      found.candidates.slice(0, MAX_NEXT).map((node) => callOf('dead', { id: node.id })),
    );
  }
  const answer = deadVerdict(db, db.report(), found.node.id, deadOptionsOf(ctx.handle));
  if (answer === undefined) return { error: `no node ${JSON.stringify(found.node.id)}` };
  const loc = locOf(answer);
  return withNext(
    {
      id: answer.id,
      type: answer.type,
      ...(answer.kind === undefined ? {} : { kind: answer.kind }),
      ...(answer.service === undefined ? {} : { service: answer.service }),
      ...(loc === undefined ? {} : { loc }),
      verdict: answer.verdict,
      reason: answer.reason,
      ...(answer.class === undefined ? {} : { class: answer.class }),
      ...(answer.role === undefined ? {} : { role: answer.role }),
      evidence: wireEvidence(answer.evidence),
      ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
    },
    verdictNext(answer.id, answer.verdict, answer.evidence, answer.service).slice(0, MAX_NEXT),
  );
};

export const registerDead = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'dead',
    {
      title: 'Is this dead',
      description: "Whether a node is dead and what could make that wrong; or a service's dead rows.",
      inputSchema: {
        id: z.string().optional(),
        service: serviceInput,
        kind: z.enum(DEAD_KINDS).optional(),
        maxNodes: commonInput.maxNodes,
        ...pageInput,
      },
      outputSchema: deadOutput,
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        if (input.id !== undefined) return answerOne(db, ctx, input.id);
        const kinds = input.kind === undefined ? LISTED_BY_DEFAULT : [input.kind];
        const rows = deadRows(db, deadOptionsOf(ctx.handle, input.service), kinds);
        const counts: Record<string, number> = {};
        for (const row of rows) counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
        const { items, total, truncated, nextOffset } = truncate(rows, input.maxNodes, input.offset);
        const first = items[0];
        const args = { service: input.service, kind: input.kind, maxNodes: input.maxNodes };
        return withNext(
          {
            rows: items,
            total,
            ...(truncated === undefined ? {} : { truncated }),
            ...(nextOffset === undefined ? {} : { nextOffset }),
            counts,
            ...(kinds.includes('entries') ? { excludedEntryKinds: [...EXTERNALLY_TRIGGERED] } : {}),
          },
          pagedNext({ tool: 'dead', args, nextOffset }, first === undefined ? [] : [callOf('dead', { id: first.id })]),
        );
      }),
  );
};
