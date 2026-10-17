import {
  compareEntryFailures,
  FAILURE_MIN_HITS,
  isJoinEdge,
  joinOfId,
  type FailureComparison,
  type GraphNode,
  type Observed,
  type ObservedFigures,
  type TraceTree,
} from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { projectDetail } from '../query/detail.js';
import { isResolved, resolveEntryRef } from '../query/entry-ref.js';
import { FORWARD_EDGES } from '../query/flow.js';
import { MAX_NEXT, withNext } from '../query/next.js';
import { loadObserved } from '../query/observed.js';
import { nearNames } from './entries.js';
import { callOf, READ_ONLY, serviceInput, withDb, type ToolContext } from './common.js';

/**
 * What real traffic did, from the observed file (P105): the steps it was
 * slowest on, the ways in it used most, one slow and one failing request
 * of an entry, step by step, and the statuses ways in answered that their
 * code never declares (P106). Every answer is bounded (I9) and ends with the
 * calls that take its ids; a row names only places the graph still has.
 */

const NO_FILE = 'nothing was observed: run flowatlas observe <trace files> beside this graph first';

/** How far a walk from an entry goes to find the joins it reaches; a step is a hop. */
const REACH_NODES = 2000;

/** The nodes and joins an entry reaches, walking the edges a flow follows. */
const reachOf = (db: GraphDb, entry: string): { nodes: Set<string>; joins: Set<string> } => {
  const nodes = new Set([entry]);
  const joins = new Set<string>();
  const queue = [entry];
  while (queue.length > 0 && nodes.size < REACH_NODES) {
    const from = queue.shift()!;
    for (const edge of db.edgesFrom(from, FORWARD_EDGES)) {
      if (isJoinEdge(edge)) joins.add(`${edge.from} -${edge.type}-> ${edge.to}`);
      if (!nodes.has(edge.to)) {
        nodes.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return { nodes, joins };
};

type Resolution = { id: string; node: GraphNode } | { failure: object };

/** An entry said as an id or aloud (`GET /orders/1`), or the answer saying why not, as get_flow says it. */
const entryFor = (db: GraphDb, said: string, tool: string): Resolution => {
  const ref = resolveEntryRef(db, said);
  if (isResolved(ref)) return { id: ref.id, node: ref.node };
  if (ref.candidates.length > 0) {
    return {
      failure: withNext(
        { candidates: ref.candidates.map((node) => projectDetail(node, 1)) },
        ref.candidates.slice(0, MAX_NEXT).map((node) => callOf(tool, { entry: node.id })),
      ),
    };
  }
  const near = nearNames(db.nodesByType('entry'), said, 5);
  return {
    failure: withNext(
      { error: `no entry matches ${JSON.stringify(said)}`, suggestions: near.map((node) => projectDetail(node, 1)) },
      near.slice(0, MAX_NEXT).map((node) => callOf(tool, { entry: node.id })),
    ),
  };
};

/** The figures of a row, each only when the file measured it. */
const figures = (seen: ObservedFigures) => ({
  ...(seen.p50 === undefined ? {} : { p50: seen.p50 }),
  ...(seen.p95 === undefined ? {} : { p95: seen.p95 }),
  ...(seen.max === undefined ? {} : { max: seen.max }),
  ...(seen.errorRate === undefined ? {} : { errorRate: seen.errorRate }),
});

/** A list cut to `limit`: the rows, and `total` with `truncated` when there were more. */
const cut = <T>(rows: readonly T[], limit: number, noun: string) => ({
  rows: rows.slice(0, limit),
  page: {
    total: rows.length,
    ...(rows.length > limit ? { truncated: `${rows.length - limit} more ${noun}; ask with a larger limit` } : {}),
  },
});

/** The first entry whose sample requests went through `id`, for a hint. */
const entryThrough = (observed: Observed, ids: readonly string[]): string | undefined => {
  const holds = (tree: TraceTree): boolean => (tree.id !== undefined && ids.includes(tree.id)) || (tree.children ?? []).some(holds);
  for (const [entry, samples] of Object.entries(observed.samples)) {
    if ([...samples.slow, ...samples.failing].some((sample) => holds(sample.tree))) return entry;
  }
  return undefined;
};

const BY = ['p95', 'max', 'p50'] as const;

interface StepRow {
  id: string;
  from?: string;
  to?: string;
  type?: string;
  label: string;
  service: string;
  count: number;
  p50?: number;
  p95?: number;
  max?: number;
  errorRate?: number;
  measuredAt?: string;
}

/** A call site's own row says what its join already does, timed on the same span. */
const CALL_SITES: ReadonlySet<string> = new Set(['http_out', 'ui_api_call']);

/** Every timed join and symbol the graph still has, as `slow_steps` rows; a call site only where no join of it was timed. */
const stepRows = (db: GraphDb, observed: Observed): StepRow[] => {
  const rows: StepRow[] = [];
  const joined = new Set<string>();
  for (const [id, seen] of Object.entries(observed.joins)) {
    const join = joinOfId(id);
    const from = join === undefined ? undefined : db.node(join.from);
    const to = join === undefined ? undefined : db.node(join.to);
    if (join === undefined || from === undefined || to === undefined || seen.p95 === undefined) continue;
    rows.push({
      id,
      from: join.from,
      to: join.to,
      type: join.type,
      label: `${from.repo} ${from.label} -> ${to.repo} ${to.label}`,
      service: from.repo,
      count: seen.count,
      ...figures(seen),
      ...(seen.measuredAt === undefined ? {} : { measuredAt: seen.measuredAt }),
    });
    joined.add(join.from);
  }
  for (const [id, seen] of Object.entries(observed.symbols)) {
    const node = db.node(id);
    if (node === undefined || seen.p95 === undefined || (CALL_SITES.has(node.type) && joined.has(id))) continue;
    rows.push({ id, label: node.label, service: node.repo, count: seen.hits, ...figures(seen) });
  }
  return rows;
};

/** A stored tree for the wire: at most `budget` rows breadth first, an id only where the graph has it, `service` where it changes. */
const treeFor = (db: GraphDb, tree: TraceTree, budget: number): { tree: TraceTree; rows: number; left: number } => {
  let left = 0;
  const slim = (node: TraceTree, parentService: string | undefined): TraceTree => {
    const { id, label, service, kind, ms, status, error } = node;
    return {
      ...(id !== undefined && db.node(id) !== undefined ? { id } : {}),
      label,
      ...(service === undefined || service === parentService ? {} : { service }),
      kind,
      ...(ms === undefined ? {} : { ms }),
      ...(status === undefined ? {} : { status }),
      ...(error === undefined ? {} : { error }),
    };
  };
  const root = slim(tree, undefined);
  let rows = 1;
  const queue: Array<[TraceTree, TraceTree]> = [[tree, root]];
  while (queue.length > 0) {
    const [stored, wire] = queue.shift()!;
    for (const child of stored.children ?? []) {
      if (rows >= budget) {
        left += 1 + countBelow(child);
        continue;
      }
      rows += 1;
      const branch = slim(child, stored.service);
      (wire.children ??= []).push(branch);
      queue.push([child, branch]);
    }
  }
  return { tree: root, rows, left };
};

const countBelow = (tree: TraceTree): number => (tree.children ?? []).reduce((sum, child) => sum + 1 + countBelow(child), 0);

/** The first method a tree names, breadth first, for a `get_source` hint. */
const firstMethod = (db: GraphDb, tree: TraceTree | undefined): string | undefined => {
  const queue = tree === undefined ? [] : [tree];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.id !== undefined && db.node(node.id)?.type === 'method') return node.id;
    queue.push(...(node.children ?? []));
  }
  return undefined;
};

/** One way in whose traffic answered a status nothing in its code declares (P106). */
interface UndeclaredRow {
  entry: string;
  label: string;
  service: string;
  hits: number;
  undeclared: FailureComparison['undeclared'];
  declaredNeverSeen?: FailureComparison['declaredNeverSeen'];
  tooFewHits?: true;
  next: string[];
}

/** What ranks a way in: requests answering a 5xx nothing explains, then any status nothing explains, then the largest share. */
const undeclaredRank = (row: UndeclaredRow): [number, number, number] => {
  const open = row.undeclared.filter((item) => item.expected === undefined);
  return [
    open.filter((item) => item.status >= 500).reduce((sum, item) => sum + item.count, 0),
    open.reduce((sum, item) => sum + item.count, 0),
    Math.max(0, ...row.undeclared.map((item) => item.share)),
  ];
};

const byUndeclaredRank = (a: UndeclaredRow, b: UndeclaredRow): number => {
  const [x, y] = [undeclaredRank(a), undeclaredRank(b)];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || (a.entry < b.entry ? -1 : 1);
};

/** The handler a way in runs, for a `get_source` hint. */
const handlerOf = (db: GraphDb, entry: string): string | undefined => db.edgesFrom(entry, ['handles'])[0]?.to;

export const registerRuntime = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'slow_steps',
    {
      title: 'Slowest steps seen',
      description: 'The joins and methods real traffic was slowest on, slowest first.',
      inputSchema: {
        entry: z.string().optional(),
        service: serviceInput,
        by: z.enum(BY).default('p95'),
        minCount: z.number().int().min(1).max(1000000).default(5),
        limit: z.number().int().min(1).max(100).default(10),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const observed = loadObserved(ctx.handle.path);
        if (observed === undefined) return { error: NO_FILE };
        let entry: string | undefined;
        let reach: { nodes: Set<string>; joins: Set<string> } | undefined;
        if (input.entry !== undefined) {
          const found = entryFor(db, input.entry, 'slow_steps');
          if ('failure' in found) return found.failure;
          entry = found.id;
          reach = reachOf(db, found.id);
        }
        const by = input.by;
        const rows = stepRows(db, observed)
          .filter((row) => row.count >= input.minCount)
          .filter((row) => input.service === undefined || row.service === input.service)
          .filter((row) => reach === undefined || (row.type === undefined ? reach.nodes.has(row.id) : reach.joins.has(row.id)))
          .sort((a, b) => (b[by] ?? -1) - (a[by] ?? -1) || b.count - a.count || (a.id < b.id ? -1 : 1));
        const { rows: steps, page } = cut(rows, input.limit, 'steps');
        const top = steps[0];
        const ids = top === undefined ? [] : [top.id, ...(top.from === undefined ? [] : [top.from]), ...(top.to === undefined ? [] : [top.to])];
        const under = entry ?? entryThrough(observed, ids);
        const sampled = under !== undefined && observed.samples[under] !== undefined;
        const source = top === undefined ? undefined : top.type === undefined ? top.id : top.from;
        return withNext(
          { steps, ...page, ...(rows.length === 0 && input.minCount > 1 ? { note: `nothing seen ${input.minCount} times; lower minCount` } : {}) },
          [
            ...(under === undefined ? [] : [callOf('get_flow', { entry: under })]),
            ...(sampled ? [callOf('trace_for', { entry: under })] : []),
            ...(source === undefined ? [] : [callOf('get_source', { symbol: source })]),
          ].slice(0, MAX_NEXT),
        );
      }),
  );

  server.registerTool(
    'hot_paths',
    {
      title: 'Busiest ways in',
      description: 'The ways in real traffic used most, each with the joins it reached most.',
      inputSchema: {
        service: serviceInput,
        limit: z.number().int().min(1).max(100).default(10),
        joins: z.number().int().min(0).max(20).default(5),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const observed = loadObserved(ctx.handle.path);
        if (observed === undefined) return { error: NO_FILE };
        const all = Object.entries(observed.entries)
          .flatMap(([id, seen]) => {
            const node = db.node(id);
            return node === undefined || (input.service !== undefined && node.repo !== input.service) ? [] : [{ id, node, seen }];
          })
          .sort((a, b) => b.seen.hits - a.seen.hits || (a.id < b.id ? -1 : 1));
        const { rows, page } = cut(all, input.limit, 'entries');
        const entries = rows.map(({ id, node, seen }) => {
          const reached = reachOf(db, id).joins;
          const joins = Object.entries(observed.joins)
            .filter(([join]) => reached.has(join))
            .sort(([a, x], [b, y]) => y.count - x.count || (a < b ? -1 : 1))
            .slice(0, input.joins)
            .map(([join, seen]) => ({ id: join, count: seen.count, ...figures(seen) }));
          return { id, label: node.label, service: node.repo, count: seen.hits, ...figures(seen), ...(joins.length === 0 ? {} : { joins }) };
        });
        const top = entries[0]?.id;
        return withNext(
          { entries, ...page },
          top === undefined
            ? []
            : [callOf('get_flow', { entry: top }), callOf('trace_for', { entry: top }), callOf('slow_steps', { entry: top, minCount: 1 })],
        );
      }),
  );

  server.registerTool(
    'trace_for',
    {
      title: 'One request, step by step',
      description: 'One slow and one failing request of an entry, as trees of the nodes they ran.',
      inputSchema: {
        entry: z.string().describe('"GET /orders/1" or an entry id'),
        maxNodes: z.number().int().min(1).max(200).default(60),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const observed = loadObserved(ctx.handle.path);
        if (observed === undefined) return { error: NO_FILE };
        const found = entryFor(db, input.entry, 'trace_for');
        if ('failure' in found) return found.failure;
        const samples = observed.samples[found.id];
        const failing = samples?.failing[0];
        // The slowest that is not the failing one: the same request is shown once.
        const slow = samples?.slow.find((sample) => sample.traceId !== failing?.traceId);
        const alsoSlowest = failing !== undefined && samples?.slow[0]?.traceId === failing.traceId;
        if (slow === undefined && failing === undefined) {
          return withNext(
            {
              entry: found.id,
              note: observed.privacy.samples.kept
                ? 'no request of this entry was sampled: run flowatlas observe over traces that reach it'
                : 'the observed file keeps no samples: run flowatlas observe without --no-samples',
            },
            [callOf('get_flow', { entry: found.id })],
          );
        }
        const shown = [slow, failing].map((sample) => (sample === undefined ? undefined : treeFor(db, sample.tree, input.maxNodes)));
        const left = shown.reduce((sum, tree) => sum + (tree?.left ?? 0), 0) + (slow?.cut ?? 0) + (failing?.cut ?? 0);
        const method = firstMethod(db, failing?.tree) ?? firstMethod(db, slow?.tree);
        return withNext(
          {
            entry: found.id,
            ...(shown[0] === undefined ? {} : { slow: shown[0].tree }),
            ...(shown[1] === undefined ? {} : { failing: shown[1].tree }),
            ...(alsoSlowest ? { note: 'the failing request is also the slowest sampled' } : {}),
            ...(left === 0 ? {} : { truncated: `${left} spans not shown; ask with a larger maxNodes` }),
          },
          [
            callOf('get_flow', { entry: found.id }),
            ...(method === undefined ? [] : [callOf('get_source', { symbol: method })]),
            callOf('slow_steps', { entry: found.id, minCount: 1 }),
          ],
        );
      }),
  );
  server.registerTool(
    'undeclared_failures',
    {
      title: 'Failures not declared',
      description: 'Ways in whose traffic got statuses their code never declares, 5xx first.',
      inputSchema: {
        service: serviceInput,
        minCount: z.number().int().min(1).max(1000000).default(1),
        minHits: z.number().int().min(1).max(1000000).default(FAILURE_MIN_HITS),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      withDb(ctx.handle, (db) => {
        const observed = loadObserved(ctx.handle.path);
        if (observed === undefined) return { error: NO_FILE };
        const all = Object.entries(observed.entries)
          .flatMap(([id, seen]): UndeclaredRow[] => {
            const node = db.node(id);
            if (node?.type !== 'entry' || (input.service !== undefined && node.repo !== input.service)) return [];
            const compared = compareEntryFailures(
              node,
              { count: seen.hits, ...(seen.statuses === undefined ? {} : { statuses: seen.statuses }) },
              { window: observed.window, minHits: input.minHits },
            );
            const undeclared = (compared?.undeclared ?? []).filter((item) => item.count >= input.minCount);
            if (compared === undefined || undeclared.length === 0) return [];
            const handler = handlerOf(db, id);
            const sampled = (observed.samples[id]?.failing.length ?? 0) > 0;
            return [
              {
                entry: id,
                label: node.label,
                service: node.repo,
                hits: compared.hits,
                undeclared,
                ...(compared.declaredNeverSeen.length === 0 ? {} : { declaredNeverSeen: compared.declaredNeverSeen }),
                ...(compared.tooFewHits === true ? { tooFewHits: true as const } : {}),
                next: [
                  ...(sampled ? [callOf('trace_for', { entry: id })] : []),
                  ...(handler === undefined ? [] : [callOf('get_source', { symbol: handler })]),
                ],
              },
            ];
          })
          .sort(byUndeclaredRank);
        const { rows: routes, page } = cut(all, input.limit, 'ways in');
        const top = routes[0]?.entry;
        return withNext(
          { routes, window: observed.window, ...page },
          top === undefined ? [] : [callOf('get_flow', { entry: top }), callOf('describe_for_prompt', { id: top })],
        );
      }),
  );
};
