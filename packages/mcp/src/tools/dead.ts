import type { GraphNode } from '@flowatlas/core';
import {
  deadChannels,
  deadEntries,
  deadJudge,
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
import { resolveChannelRef } from '../query/channel-ref.js';
import { declaredBy, isDeclared } from '../query/declared.js';
import { isResolved, resolveSymbol, type EntryRef } from '../query/entry-ref.js';
import { nearNames } from '../query/names.js';
import { MAX_NEXT, withNext, withoutShown } from '../query/next.js';
import { deadOptionsOf, reachOfVerdict, reachReader, type ReachReader } from '../query/ways-in.js';
import {
  answerEach,
  answersOutput,
  askedOf,
  callOf,
  commonInput,
  completeOf,
  completeOutput,
  nextOutput,
  pageLeft,
  nodeOutput,
  pagedNext,
  pageInput,
  pageOutput,
  READ_ONLY,
  reachOutput,
  serviceInput,
  severalInput,
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

/** Moved beside the reach every answer's rows carry (P364), which reads them the same way. */
export { deadOptionsOf };

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
  verdict: z.enum(['dead', 'likely-dead', 'maybe', 'unknown', 'alive']).optional(),
  reason: z.string().optional(),
  class: z.string().optional(),
  role: z.string().optional(),
  evidence: evidenceOutput.optional(),
  uncalled: z.number().optional(),
  callers: z.number().optional(),
  reach: reachOutput.reach,
  throughDead: reachOutput.throughDead,
  from: reachOutput.from,
  ways: reachOutput.ways,
  walkCut: reachOutput.walkCut,
  gap: reachOutput.gap,
  behind: reachOutput.behind,
  alsoAnswers: z.array(z.string()).optional(),
  channelUsed: z.string().optional(),
  rows: z.array(deadRowOutput).optional(),
  file: z.string().optional(),
  /** Each way in a class or a file declares, judged (P375): `{id, verdict, reason?, callers?, caller?}`. */
  waysIn: z.array(z.record(z.string(), z.unknown())).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  excludedEntryKinds: z.array(z.string()).optional(),
  ...pageOutput,
  total: z.number().optional(),
  candidates: z.array(nodeOutput).optional(),
  answers: answersOutput,
  ...completeOutput,
  next: nextOutput,
};

/** The ways in a class, a method or a file declares, each with its verdict (P375): an alive one with who calls it first, any other with why. */
interface WayInJudged {
  row: Record<string, unknown>;
  /** No caller in the project joins it, and nothing outside is said to call it (P381): dead, or a maybe. */
  uncalled: boolean;
}

const waysInJudged = (db: GraphDb, ctx: ToolContext, entries: readonly GraphNode[]): WayInJudged[] => {
  const judge = deadJudge(db, db.report(), deadOptionsOf(ctx.handle));
  return entries.flatMap((entry) => {
    const answer = judge(entry.id);
    if (answer === undefined) return [];
    const { callers, caller } = answer.evidence;
    const joined = typeof callers === 'number' ? callers : 0;
    const reach = reachOfVerdict(entry, answer);
    return [
      {
        row: {
          id: entry.id,
          verdict: answer.verdict,
          ...(answer.verdict === 'alive' ? {} : { reason: answer.reason }),
          // The fact beside the verdict (P381): how many callers the project joins to it, none said as 0.
          callers: joined,
          ...(typeof caller === 'string' && caller !== '' ? { caller } : {}),
        },
        uncalled: joined === 0 && (reach === 'dead' || reach === 'maybe'),
      },
    ];
  });
};

/**
 * What `dead` lists the ways in of: a class (a controller, a bot's class), which declares them by its methods
 * handling them. A method's verdict is its way in's already, and a component's names the screens it is routed at.
 */
const DECLARING_TYPES: ReadonlySet<string> = new Set(['provider']);

/** The code a caller joins to (a route, a method, a function), whose answer says how many callers it has (P381). */
const CALLED_TYPES: ReadonlySet<string> = new Set(['entry', 'method', 'function']);

/**
 * The ways in judged, how many no code calls, and the code of the first to read before removing it. Uncalled is the
 * fact (P381): no caller joins it and nothing outside the project is said to call it - judged `dead`, or a maybe
 * (`likely-dead`, or `unknown` with a request one segment off) - not the `dead` verdicts alone.
 */
const waysInSaid = (judged: readonly WayInJudged[]): { said: object; next: string[] } => {
  const uncalled = judged.filter((item) => item.uncalled).map((item) => item.row);
  return {
    said: { waysIn: judged.map((item) => item.row), uncalled: uncalled.length, complete: true },
    next: uncalled.slice(0, 1).map((row) => callOf('get_source', { symbol: String(row['id']) })),
  };
};

/**
 * One node, by any name a tool takes; a channel by its bare name too, and as
 * a value it takes (`tenant:42:events`) when nothing else answers to it (P360).
 * A file is answered by the ways in it declares (P375).
 */
const answerOne = (db: GraphDb, ctx: ToolContext, reader: ReachReader, ref: string): object => {
  const byFile = db.node(ref.trim()) === undefined ? declaredBy(db, ref) : undefined;
  if (byFile !== undefined && isDeclared(byFile) && byFile.file !== undefined && byFile.entries.length > 0) {
    const { said, next } = waysInSaid(waysInJudged(db, ctx, byFile.entries));
    return withNext({ file: byFile.file, ...said }, next);
  }
  const channel = db.node(`channel:${ref.trim()}`);
  const named = channel === undefined ? resolveSymbol(db, ref) : { id: channel.id, node: channel };
  const valued = isResolved(named) || named.candidates.length > 0 ? undefined : resolveChannelRef(db, ref);
  const found: EntryRef =
    valued === undefined
      ? named
      : 'candidates' in valued
        ? { candidates: valued.candidates }
        : { id: valued.node.id, node: valued.node, ...(valued.channelUsed === undefined ? {} : { channelUsed: valued.channelUsed }) };
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
  // Where it is reached from (P364), so an alive answer needs no who_calls after it.
  const { reach, from, ways, walkCut, gap, behind, throughDead } = reader.of(answer.id);
  // Said in the words every other answer's rows say it (P396): code an unread call could reach is `maybe` here as in
  // impact and who_calls, with the same gap, where `likely-dead` beside a `maybe` row sent an agent to find out which.
  // Traffic's word (`neverSeen`) stays its own: it is evidence beside the code, not a call the reading could not follow.
  const unread = answer.verdict === 'likely-dead' || (answer.verdict === 'unknown' && answer.evidence.oneOff !== undefined);
  const verdict = reach === 'maybe' && unread && answer.evidence.neverSeen === undefined ? 'maybe' : answer.verdict;
  const reachSaid = reach === 'unreached' && answer.verdict === 'likely-dead' ? { reach } : {};
  // The fact before the verdict (P381): no caller in the project joins it, said as a count beside the judgment.
  const uncalled = CALLED_TYPES.has(answer.type) && typeof answer.evidence.callers !== 'number' ? { callers: 0 } : {};
  // A class answers for the ways in it declares too, each judged (P375): which routes of a controller no code calls is
  // this one answer.
  const declared = DECLARING_TYPES.has(found.node.type) ? declaredBy(db, found.node.id) : undefined;
  const declaredSaid =
    declared === undefined || !isDeclared(declared) || declared.entries.length === 0 ? undefined : waysInSaid(waysInJudged(db, ctx, declared.entries));
  return withNext(
    {
      id: answer.id,
      type: answer.type,
      ...(answer.kind === undefined ? {} : { kind: answer.kind }),
      ...(answer.service === undefined ? {} : { service: answer.service }),
      ...(loc === undefined ? {} : { loc }),
      verdict,
      reason: answer.reason,
      ...reachSaid,
      ...uncalled,
      // Called, but only through ways in judged dead (P381): it runs only when one of them does, so not a bare alive.
      ...(throughDead === true ? { reach: 'dead', throughDead } : {}),
      ...(answer.class === undefined ? {} : { class: answer.class }),
      ...(answer.role === undefined ? {} : { role: answer.role }),
      evidence: wireEvidence(answer.evidence),
      // The ways in a class declares, each judged, say where it is reached from: not the nearest of them again.
      ...(from === undefined || declaredSaid !== undefined ? {} : { from }),
      ...(ways === undefined || declaredSaid !== undefined ? {} : { ways }),
      ...(walkCut === undefined || declaredSaid !== undefined ? {} : { walkCut }),
      // A maybe's unread call and the code its chain stops at (P367); `reason` already says why otherwise.
      ...(gap === undefined ? {} : { gap }),
      ...(behind === undefined || behind === answer.reason ? {} : { behind }),
      ...(found.alsoAnswers === undefined ? {} : { alsoAnswers: found.alsoAnswers }),
      ...(found.channelUsed === undefined ? {} : { channelUsed: found.channelUsed }),
      ...(declaredSaid?.said ?? {}),
    },
    [
      // The code of the first way in it declares that no code calls, which is what to read before removing it.
      ...(declaredSaid?.next ?? []),
      ...(declaredSaid !== undefined
        ? []
        : withoutShown(verdictNext(answer.id, answer.verdict, answer.evidence, answer.service), [{ id: answer.id, ...(from === undefined ? {} : { from }) }])),
      // Several ways in, of which `from` names the nearest: impact lists them all, unless the answer judged each.
      ...(ways === undefined || declaredSaid !== undefined ? [] : [callOf('impact', { symbol: answer.id })]),
    ].slice(0, MAX_NEXT),
  );
};

export const registerDead = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'dead',
    {
      title: 'Is this dead',
      description:
        "Whether a node is `dead`, `likely-dead` (a call read in part could reach it: `couldHit`), `maybe` (an unread call could: `gap`), `unknown` or `alive`, and why; a class or file judges its ways in (`waysIn`); or a service's dead rows.",
      inputSchema: {
        id: z.string().optional(),
        ids: severalInput(),
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
        const asked = askedOf(input.id, input.ids);
        if (asked.length > 0) {
          const reader = reachReader(db, ctx.handle, 1);
          if (asked.length === 1) return answerOne(db, ctx, reader, asked[0]!);
          return answerEach('id', asked, (id) => answerOne(db, ctx, reader, id));
        }
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
            ...completeOf([pageLeft(total, items.length, input.offset, nextOffset)]),
          },
          pagedNext({ tool: 'dead', args, nextOffset }, first === undefined ? [] : [callOf('dead', { id: first.id })]),
        );
      }),
  );
};
