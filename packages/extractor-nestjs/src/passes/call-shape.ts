import { join } from 'node:path';
import {
  BOUNDED_BY,
  callShapeOf,
  callsOnLine,
  isMigrationFile,
  siteNodeAt,
  SITE_LEAF_TYPES,
  type BoundedBy,
  type BoundedLoopOptions,
  type CallShape,
  type GraphBuilder,
  type GraphEdge,
  type GraphNode,
} from '@flowatlas/core';
import type { Project, SourceFile } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import { definePass } from './types.js';

/**
 * Calls in a loop, and calls side by side (P69); the loops worth fixing (P89).
 *
 * Every call edge is looked up at its site. One inside a loop gets
 * `meta.inLoop: { kind, line, bounded? }`; one inside the arguments of
 * `Promise.all`, `allSettled`, `race` or `any` gets `meta.concurrent: true`
 * and `meta.together: { by, line }`, which is what the Steps view draws side
 * by side.
 *
 * A loop that runs a query, cache call, HTTP call or publish once per item -
 * directly, or through a function it calls - is one `query-in-loop` row, at
 * the loop's line, naming every leaf it reaches. A loop bounded on purpose
 * (chunks, pages, cursors, retries, a literal list, nothing but batch calls,
 * a migration) writes no row and is counted by why in the stats. A loop whose
 * every leaf runs per item on purpose - a conditional write, a send to one
 * recipient - is a note; the rest are likely N+1, and each says how many ways
 * in of this service reach it, which is what they are ranked by.
 */

/** How many leaves a row names, nearest first; the rest are counted in `reachesCut` (I9). */
export const MOST_REACHED = 8;

/** How many nodes one search through calls visits before it stops. */
const MAX_WALKED = 2000;

/** How many ways in a row names by id; `waysIn` counts them all. */
const ENTRIES_NAMED = 3;

/** What a leaf does, in the words a row about running it per item uses. */
const LEAF_WORDS: ReadonlyMap<string, { one: string; many: string }> = new Map([
  ['db_query', { one: 'database query', many: 'database queries' }],
  ['cache_op', { one: 'cache call', many: 'cache calls' }],
  ['http_out', { one: 'HTTP call', many: 'HTTP calls' }],
  ['producer', { one: 'publish', many: 'publishes' }],
  ['ui_api_call', { one: 'API call', many: 'API calls' }],
]);

const SITE_LEAVES: ReadonlySet<string> = new Set(SITE_LEAF_TYPES);

/** Interfaces a migration class implements: TypeORM's (P89). */
const MIGRATION_INTERFACES: readonly string[] = ['MigrationInterface'];

/** The edges a way in reaches code along, as the failures walk goes (`failuresFrom`). */
const WAYS_IN_EDGES: ReadonlySet<string> = new Set(['handles', 'calls']);

const LIKELY_HINT =
  'Read every item in one call - a list of ids, a batch, a join - before the loop, and look each one up in memory.';
const NOTE_HINT =
  'Nothing to fix: a write that changes a row only in the state it expects, or a send to one recipient, has no batch form. If one of them has one after all, use it and the loop is no longer listed.';

/** `<type>:<repo>#<file>:<line>:<col>` read back, for a leaf of a kind this pass reads. */
const leafSite = (id: string): { type: string; file: string; line: number; column: number } | undefined => {
  const match = /^([a-z_]+):[^#]*#(.+):(\d+):(\d+)$/.exec(id);
  if (match === null) return undefined;
  const [, type, file, line, column] = match;
  if (type === undefined || file === undefined || !SITE_LEAVES.has(type)) return undefined;
  return { type, file, line: Number(line), column: Number(column) };
};

/** The name a call to a function or method node is made by: what follows its last `.` or `:`. */
const calleeName = (id: string): string | undefined => {
  const tail = id.slice(id.lastIndexOf('#') + 1);
  const name = tail.slice(Math.max(tail.lastIndexOf('.'), tail.lastIndexOf(':')) + 1);
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
};

/** Sources by repository-relative path, each opened once. */
const sourcesOf = (project: Project, repoDir: string): ((file: string) => SourceFile | undefined) => {
  const opened = new Map<string, SourceFile | undefined>();
  return (file) => {
    if (!opened.has(file)) opened.set(file, project.getSourceFile(join(repoDir, file)));
    return opened.get(file);
  };
};

/** What every call on a line agrees on; a disagreement says nothing. */
const agreed = (shapes: readonly CallShape[]): CallShape => {
  const [first] = shapes;
  if (first === undefined) return {};
  const shape: CallShape = {};
  if (first.loop !== undefined && shapes.every((s) => s.loop !== undefined)) shape.loop = first.loop;
  if (first.concurrent !== undefined && shapes.every((s) => s.concurrent !== undefined)) {
    shape.concurrent = first.concurrent;
  }
  return shape;
};

const shapeOfEdge = (
  edge: GraphEdge,
  open: (file: string) => SourceFile | undefined,
  options: BoundedLoopOptions,
): CallShape => {
  const leaf = leafSite(edge.to);
  if (leaf !== undefined) {
    const source = open(leaf.file);
    const node = source === undefined ? undefined : siteNodeAt(source, leaf.line, leaf.column);
    return node === undefined ? {} : callShapeOf(node, options);
  }
  if (edge.file === undefined || edge.line === undefined) return {};
  const name = calleeName(edge.to);
  const source = open(edge.file);
  if (name === undefined || source === undefined) return {};
  return agreed(callsOnLine(source, edge.line, name).map((call) => callShapeOf(call, options)));
};

const mark = (edge: GraphEdge, shape: CallShape): void => {
  if (shape.loop === undefined && shape.concurrent === undefined) return;
  edge.meta = {
    ...edge.meta,
    ...(shape.loop === undefined ? {} : { inLoop: { ...shape.loop } }),
    ...(shape.concurrent === undefined ? {} : { concurrent: true, together: { ...shape.concurrent } }),
  };
};

/** `meta.inLoop` as the pass wrote it. */
interface LoopMark {
  kind: string;
  line: number;
  bounded?: BoundedBy;
}

const loopOf = (edge: GraphEdge): LoopMark | undefined => edge.meta?.['inLoop'] as LoopMark | undefined;

/** A leaf a loop reaches: how far from the loop, through which call, and whether a guarded helper was on the way. */
interface Reached {
  id: string;
  type: string;
  depth: number;
  via?: string;
  /** Reached through a function the configuration names as a conditional write. */
  guarded: boolean;
}

/** Keeps the nearest of two readings of one leaf, unguarded if either path is. */
const nearer = (known: Reached | undefined, found: Reached): Reached => {
  if (known === undefined) return found;
  const guarded = known.guarded && found.guarded;
  return found.depth < known.depth ? { ...found, guarded } : { ...known, guarded };
};

/**
 * Every leaf worth a row that a node reaches through calls, nearest first,
 * asked once per node: every edge in a loop into one method - a save or a
 * lookup called from many loops - reaches the same leaves, and the search it
 * costs grows with the graph (P79). A leaf is where a search stops; a node
 * named under `callShape.conditionalWrites` marks everything below it.
 */
const leavesReached = (
  callsFrom: ReadonlyMap<string, readonly string[]>,
  isGuard: (id: string) => boolean,
): ((from: string) => readonly Reached[]) => {
  const known = new Map<string, readonly Reached[]>();
  const search = (from: string): Reached[] => {
    const found = new Map<string, Reached>();
    const seen = new Set<string>();
    const start = { id: from, depth: 0, guarded: isGuard(from) };
    const queue = [start];
    seen.add(`${from}\u0000${String(start.guarded)}`);
    for (let i = 0; i < queue.length && seen.size < MAX_WALKED; i += 1) {
      const at = queue[i] as (typeof queue)[number];
      for (const to of callsFrom.get(at.id) ?? []) {
        const leaf = leafSite(to);
        if (leaf !== undefined && LEAF_WORDS.has(leaf.type)) {
          found.set(to, nearer(found.get(to), { id: to, type: leaf.type, depth: at.depth, guarded: at.guarded }));
          continue;
        }
        const guarded = at.guarded || isGuard(to);
        const key = `${to}\u0000${String(guarded)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ id: to, depth: at.depth + 1, guarded });
      }
    }
    return [...found.values()].sort((a, b) => a.depth - b.depth);
  };
  return (from) => {
    let list = known.get(from);
    if (list === undefined) {
      list = search(from);
      known.set(from, list);
    }
    return list;
  };
};

/**
 * How many ways in of this service reach a node, by one search backwards from
 * it along what a way in reaches code by (D4): a route three front ends call
 * is one way in here. Asked once per node that holds a loop.
 */
const waysInto = (
  edges: readonly GraphEdge[],
  entries: ReadonlySet<string>,
): ((holder: string) => { count: number; ids: string[] }) => {
  const into = new Map<string, string[]>();
  for (const edge of edges) {
    if (!WAYS_IN_EDGES.has(edge.type)) continue;
    const list = into.get(edge.to);
    if (list === undefined) into.set(edge.to, [edge.from]);
    else list.push(edge.from);
  }
  const known = new Map<string, { count: number; ids: string[] }>();
  return (holder) => {
    const cached = known.get(holder);
    if (cached !== undefined) return cached;
    const seen = new Set([holder]);
    const queue = [holder];
    const found: string[] = [];
    for (let i = 0; i < queue.length && seen.size < MAX_WALKED; i += 1) {
      for (const from of into.get(queue[i] as string) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        queue.push(from);
        if (entries.has(from)) found.push(from);
      }
    }
    if (entries.has(holder)) found.push(holder);
    found.sort();
    const answer = { count: found.length, ids: found.slice(0, ENTRIES_NAMED) };
    known.set(holder, answer);
    return answer;
  };
};

/** "2 database queries and 1 publish", in the order the kinds are listed above. */
const kindsSaid = (reached: readonly Reached[]): string => {
  const counts = new Map<string, number>();
  for (const leaf of reached) counts.set(leaf.type, (counts.get(leaf.type) ?? 0) + 1);
  const parts = [...LEAF_WORDS]
    .filter(([type]) => counts.has(type))
    .map(([type, words]) => {
      const n = counts.get(type) as number;
      return `${n} ${n === 1 ? words.one : words.many}`;
    });
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
};

/** One loop of one method or function: the edges inside it, at the loop's line. */
interface LoopGroup {
  holder: string;
  file: string;
  loop: LoopMark;
  edges: GraphEdge[];
}

const groupLoops = (calls: readonly GraphEdge[]): LoopGroup[] => {
  const groups = new Map<string, LoopGroup>();
  for (const edge of calls) {
    const loop = loopOf(edge);
    if (loop === undefined || edge.file === undefined) continue;
    const key = `${edge.from}\u0000${edge.file}\u0000${loop.line}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { holder: edge.from, file: edge.file, loop, edges: [edge] });
    else group.edges.push(edge);
  }
  return [...groups.values()];
};

/** Every leaf the loop's edges reach, nearest first, each once. */
const reachedBy = (group: LoopGroup, reached: (from: string) => readonly Reached[]): Reached[] => {
  const found = new Map<string, Reached>();
  for (const edge of group.edges) {
    const leaf = leafSite(edge.to);
    if (leaf !== undefined) {
      if (LEAF_WORDS.has(leaf.type)) found.set(edge.to, nearer(found.get(edge.to), { id: edge.to, type: leaf.type, depth: 0, guarded: false }));
      continue;
    }
    for (const item of reached(edge.to)) {
      found.set(item.id, nearer(found.get(item.id), { ...item, depth: item.depth + 1, via: edge.to }));
    }
  }
  return [...found.values()].sort((a, b) => a.depth - b.depth);
};

/** What the configuration says a loop may do on purpose. */
interface OnPurpose {
  perItemHosts: ReadonlySet<string>;
}

/** Whether a leaf runs per item on purpose: a conditional write, or a send to one recipient. */
const perItemOnPurpose = (leaf: Reached, node: GraphNode | undefined, settings: OnPurpose): boolean => {
  if (leaf.guarded) return true;
  const meta = node?.meta ?? {};
  if (meta['conditional'] === true || meta['perItem'] === true) return true;
  return leaf.type === 'http_out' && typeof meta['host'] === 'string' && settings.perItemHosts.has(meta['host']);
};

const isBatch = (node: GraphNode | undefined): boolean => node?.meta?.['batch'] === true;

/** Writes the reason a loop is set aside on every edge in it, for a reason the shape did not give. */
const setAside = (group: LoopGroup, by: BoundedBy): void => {
  for (const edge of group.edges) {
    const loop = loopOf(edge);
    if (loop !== undefined && loop.bounded === undefined) edge.meta = { ...edge.meta, inLoop: { ...loop, bounded: by } };
  }
};

const report = (
  builder: GraphBuilder,
  group: LoopGroup,
  reached: readonly Reached[],
  settings: OnPurpose,
  ways: { count: number; ids: string[] },
): void => {
  const { loop } = group;
  const note = reached.every((leaf) => perItemOnPurpose(leaf, builder.getNode(leaf.id), settings));
  const said = kindsSaid(reached);
  const shown = reached.slice(0, MOST_REACHED);
  builder.addUnresolved({
    file: group.file,
    line: loop.line,
    reason: 'query-in-loop',
    // Info either way, and never a miss. A likely N+1 is a finding; a loop
    // whose every leaf runs per item on purpose is a note (row-kind.ts, P81).
    level: 'info',
    sites: 1,
    message: note
      ? `A \`${loop.kind}\` loop runs ${said} once per item, each a conditional write or a send to one recipient: per item on purpose.`
      : `A \`${loop.kind}\` loop runs ${said} once per item: likely N+1.`,
    hint: note ? NOTE_HINT : LIKELY_HINT,
    symbol: group.holder,
    meta: {
      loop: { kind: loop.kind, line: loop.line },
      reaches: shown.map((leaf) => ({
        id: leaf.id,
        type: leaf.type,
        words: LEAF_WORDS.get(leaf.type)?.one ?? leaf.type,
        ...(leaf.via === undefined ? {} : { via: leaf.via }),
      })),
      ...(reached.length > shown.length ? { reachesCut: reached.length - shown.length } : {}),
      severity: note ? 'note' : 'likely',
      waysIn: ways.count,
      entries: ways.ids,
      ...(group.edges.some((edge) => edge.meta?.['concurrent'] === true) ? { concurrent: true } : {}),
    },
  });
};

export const callShapePass = definePass('call-shape', (ctx: NestExtractContext) => {
  const settings = ctx.config.callShape;
  const options: BoundedLoopOptions = { boundedCalls: settings.boundedCalls };
  const open = sourcesOf(ctx.project, ctx.repoDir);
  const calls = ctx.builder.edges.filter((edge) => edge.type === 'calls');
  const callsFrom = new Map<string, string[]>();
  for (const edge of calls) {
    const list = callsFrom.get(edge.from);
    if (list === undefined) callsFrom.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  for (const edge of calls) mark(edge, shapeOfEdge(edge, open, options));

  const guards = new Set(settings.conditionalWrites);
  const reached = leavesReached(callsFrom, (id) => {
    const name = calleeName(id);
    return name !== undefined && guards.has(name);
  });
  const entries = new Set(ctx.builder.nodes.filter((node) => node.type === 'entry').map((node) => node.id));
  const ways = waysInto(ctx.builder.edges, entries);
  const onPurpose: OnPurpose = { perItemHosts: new Set(settings.perItemHosts) };
  const migrations = new Map<string, boolean>();
  const isMigration = (file: string): boolean => {
    let known = migrations.get(file);
    if (known === undefined) {
      known = isMigrationFile(file, open(file), { interfaces: MIGRATION_INTERFACES });
      migrations.set(file, known);
    }
    return known;
  };

  const bounded = new Map<BoundedBy, number>();
  for (const group of groupLoops(calls)) {
    const migration = isMigration(group.file);
    if (migration) setAside(group, 'migration');
    const leaves = reachedBy(group, reached);
    if (leaves.length === 0) continue;
    const by =
      group.loop.bounded ??
      (migration ? 'migration' : leaves.every((leaf) => isBatch(ctx.builder.getNode(leaf.id))) ? 'batch-call' : undefined);
    if (by !== undefined) {
      if (by === 'batch-call') setAside(group, by);
      bounded.set(by, (bounded.get(by) ?? 0) + 1);
      continue;
    }
    report(ctx.builder, group, leaves, onPurpose, ways(group.holder));
  }
  // Never silent (I3): what was set aside is counted by why.
  if (bounded.size > 0) {
    ctx.stats.loopsBounded = Object.fromEntries(BOUNDED_BY.filter((by) => bounded.has(by)).map((by) => [by, bounded.get(by) as number]));
  }
});
