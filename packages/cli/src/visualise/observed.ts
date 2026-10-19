import {
  blindSpotNext,
  compareEntryFailures,
  comparisonSays,
  joinIdOf,
  type FailureComparison,
  type GraphEdge,
  type GraphNode,
  type MeasuredAt,
  type Observed,
  type ObservedFigures,
  type ObservedSample,
  type ObservedWindow,
  type TraceTree,
} from '@flowatlas/core';
import type { AnchoredUnresolvedRow } from '@flowatlas/linker';
import { diffObserved, type DiffKind, type ObservedDiffRow } from '../observe/diff.js';
import { wordsOf, type Word } from './dictionary.js';

/**
 * What `flowatlas observe` saw, keyed the way the page addresses things.
 *
 *   observed: {
 *     joins:   { [edgeId]: { count, lastSeen, ...stats, measuredAt? } },   // edgeId: position in `edges`, as a string
 *     entries: { [entryId]: { hits, ...stats } },   // entryId: entry node id, a key of `entryIds`
 *     window?: { since?, from, to },                // the hours the counts cover (P105)
 *     failures?: { [entryId]: FailureSeen },        // statuses answered against the failures declared (P106)
 *     unmatched: [[service, kind, name, next?]],    // seen at run time, not found in code; `next` looks for it (P110)
 *     never?: { window, rows: [[node, strong]] },   // what the code runs and traffic never touched (P110)
 *     confirmed?: [edge],                           // best guesses traffic went through (P110)
 *     drift?: { [entryId]: [fields, paths] },       // bodies traffic carried that differ from the code (P113)
 *     ambiguous?: [[service, kind, name, count, places, unnamed?]],  // fit several places (P85)
 *     services?: [name], kinds?: [kind]             // what `service` and `kind` index (P84)
 *     blind?: [[service, level, message]],          // the blind spots as check rows, for their prompt (P144)
 *   }
 *
 * `lastSeen` is an ISO time or null. A row's `service` is a position in
 * `services`, -1 when the trace names none, and its `kind` one in `kinds`
 * (unmatched: http, client, messaging, code, db, rpc; ambiguous: entry, join,
 * client, symbol, table); either is the word itself where listing it would
 * not pay (`wordsOf`). An ambiguous row's `places` are edge positions for a
 * `join` and node positions otherwise; `unnamed` counts candidates it does not
 * list. `unmatchedOf` and `ambiguousOf` (steps.js) expand the rows. Present
 * only when the observed file sits beside the database.
 *
 * `stats` (P105) are what the file measured, each only when it did: `p50`,
 * `p95`, `max` in milliseconds, `errors`, `errorRate` (only above 0) and
 * `statuses` (status → count). `nodes` (P111) holds a method's, a call
 * site's, a table's or a channel's own figures by node position, for a step
 * no join into it measured; `samples` the slowest and the latest failing
 * request of each way in, as trees of node positions with no ids at all
 * (`PackedSample`). `createSeen` hands them out as `stats(k)`,
 * `entryStats(i)`, `nodeStats(i)`, `figuresOf(k, i)` and `samples(i)`; the
 * Steps waterfall, the Map heat and the Traces tab draw them.
 *
 * `failures` (P106) is core's `compareSeenFailures` for each way in seen with
 * a status that has something to say, without the entry id its key already
 * is: the statuses it answered that no failure declares, the declared ones
 * seen and never seen, over `window`. The Steps failure chips and the copied
 * prompt read it; `failSeenOf` (steps.js) hands it out.
 *
 * `never` and `confirmed` (P110) are the linker's `neverSeen` and
 * `confirmedJoins`, worked out by the command over the database and handed
 * in as `traffic`: `never.rows` are node positions with `1` for a strong row
 * (a busy neighbour) and `0` for a weak one, over `never.window` (`2h`);
 * `confirmed` are positions in `edges` of `heuristic` joins the window holds.
 * An unmatched row's `next` is the MCP call that looks for it in the map,
 * the text `cant_follow` names.
 *
 * `drift` (P113) is the contracts package's `compareTraffic` for each way in
 * `observe --shapes` read bodies of whose traffic differs from its code: how
 * many fields, and the paths (`request giftNote`, `200 owner`), worked out by
 * the command and handed in as `traffic.drift`. The Steps header's
 * `traffic differs` chip reads it.
 */
export type PackedAmbiguous = [service: Word, kind: Word, name: string, count: number, places: number[], unnamed?: number];

export interface PackedStats {
  p50?: number;
  p95?: number;
  max?: number;
  errors?: number;
  /** The share of requests that failed (P111), only when some did. */
  errorRate?: number;
  statuses?: Record<string, number>;
}

/**
 * One span of a packed sample (P111): the node it was credited to as a
 * position in `nodes` (none when the map has no such node), what it said,
 * when it began after the request did and how long it took, in ms. `service`
 * is written only where it changes from the span above.
 */
export interface PackedTraceTree {
  node?: number;
  label: string;
  service?: string;
  kind: string;
  start?: number;
  ms?: number;
  status?: number;
  error?: true;
  children?: PackedTraceTree[];
}

/**
 * One request of a way in as the page draws it (P111): the slowest one and
 * the latest failing one, once when they are the same request. No trace id,
 * span id or time of day: the page travels, and nothing in it may be joined
 * back to a request.
 */
export interface PackedSample {
  slow?: 1;
  failing?: 1;
  ms?: number;
  status?: number;
  error?: true;
  /** Spans in `tree`, and the spans under the request P105 left out past its cap. */
  spans: number;
  cut?: number;
  tree: PackedTraceTree;
}

/** A comparison as the page holds it: the entry id is its key. */
export type PackedFailuresSeen = Omit<FailureComparison, 'entry'>;

export interface PackedObserved {
  joins: Record<string, { count: number; lastSeen: string | null; measuredAt?: MeasuredAt } & PackedStats>;
  entries: Record<string, { hits: number } & PackedStats>;
  /** A method's, a call site's, a table's or a channel's own figures (P111), by node position; only rows that measured one. */
  nodes?: Record<string, PackedStats>;
  /** Requests to draw (P111), by entry id. */
  samples?: Record<string, PackedSample[]>;
  window?: ObservedWindow;
  failures?: Record<string, PackedFailuresSeen>;
  unmatched: Array<[service: Word, kind: Word, name: string, next?: string]>;
  never?: { window: string; rows: Array<[node: number, strong: 0 | 1]> };
  confirmed?: number[];
  drift?: Record<string, [fields: number, paths: string[]]>;
  ambiguous?: PackedAmbiguous[];
  services?: string[];
  kinds?: string[];
  /** One per blind-spot row, its gap `gap:<service>||seen-not-in-code` (P144): what its check's prompt says. */
  blind?: Array<[service: string, level: string, message: string]>;
}

/** What the command worked out of traffic over the graph (P110), by id: handed in, never computed here. */
export interface PackTraffic {
  never: { window: string; rows: ReadonlyArray<{ id: string; confidence: 'strong' | 'weak' }> };
  /** Join ids of best guesses traffic went through. */
  confirmed: readonly string[];
  /** Ways in whose bodies differ from their code (P113): how many fields, and which. */
  drift?: ReadonlyArray<{ entry: string; fields: number; paths: readonly string[] }>;
  /**
   * The blind spots as rows (P110's `blindSpotRows`, split as the server
   * splits them): what a check's prompt and the repository probably missing
   * are gathered from on the page, as `describe_for_prompt` gathers them (P144).
   */
  blind?: readonly AnchoredUnresolvedRow[];
}

/** The figures a row measured, each only when it did. */
const statsOf = (seen: ObservedFigures): PackedStats => {
  const stats: PackedStats = {};
  if (seen.p50 !== undefined) stats.p50 = seen.p50;
  if (seen.p95 !== undefined) stats.p95 = seen.p95;
  if (seen.max !== undefined) stats.max = seen.max;
  if (seen.errors !== undefined && seen.errors > 0) stats.errors = seen.errors;
  if (seen.errorRate !== undefined && seen.errorRate > 0) stats.errorRate = seen.errorRate;
  if (seen.statuses !== undefined) stats.statuses = seen.statuses;
  return stats;
};

/** A node's own figures, or none when it measured no time and no failure (P111). */
const ownStatsOf = (seen: ObservedFigures): PackedStats | undefined => {
  const { p50, p95, max, errorRate } = statsOf(seen);
  if (p50 === undefined && p95 === undefined && errorRate === undefined) return undefined;
  return {
    ...(p50 === undefined ? {} : { p50 }),
    ...(p95 === undefined ? {} : { p95 }),
    ...(max === undefined ? {} : { max }),
    ...(errorRate === undefined ? {} : { errorRate }),
  };
};

/** A sample's tree with node positions for ids, the service only where it changes, and nothing else. */
const packTree = (tree: TraceTree, position: ReadonlyMap<string, number>, above: string | undefined): PackedTraceTree => {
  const node = tree.id === undefined ? undefined : position.get(tree.id);
  const children = (tree.children ?? []).map((child) => packTree(child, position, tree.service ?? above));
  return {
    ...(node === undefined ? {} : { node }),
    label: tree.label,
    ...(tree.service === undefined || tree.service === above ? {} : { service: tree.service }),
    kind: tree.kind,
    ...(tree.start === undefined ? {} : { start: tree.start }),
    ...(tree.ms === undefined ? {} : { ms: tree.ms }),
    ...(tree.status === undefined ? {} : { status: tree.status }),
    ...(tree.error === undefined ? {} : { error: tree.error }),
    ...(children.length === 0 ? {} : { children }),
  };
};

/**
 * The requests a way in's Traces rows draw (P111): its slowest sample and its
 * latest failing one, once when they are one request. The trace id decides
 * that here and goes no further.
 */
const packSamples = (
  samples: Observed['samples'] | undefined,
  entryIds: Readonly<Record<string, number>>,
  position: ReadonlyMap<string, number>,
): Record<string, PackedSample[]> => {
  const packed: Record<string, PackedSample[]> = {};
  for (const [id, { slow, failing }] of Object.entries(samples ?? {})) {
    if (entryIds[id] === undefined) continue;
    const kept: Array<{ sample: ObservedSample; slow: boolean; failing: boolean }> = [];
    if (slow[0] !== undefined) kept.push({ sample: slow[0], slow: true, failing: slow[0].error === true });
    const bad = failing[0];
    if (bad !== undefined) {
      const same = kept.find((one) => one.sample.traceId === bad.traceId);
      if (same === undefined) kept.push({ sample: bad, slow: false, failing: true });
      else same.failing = true;
    }
    if (kept.length === 0) continue;
    packed[id] = kept.map(({ sample, slow: isSlow, failing: isFailing }) => ({
      ...(isSlow ? { slow: 1 as const } : {}),
      ...(isFailing ? { failing: 1 as const } : {}),
      ...(sample.ms === undefined ? {} : { ms: sample.ms }),
      ...(sample.status === undefined ? {} : { status: sample.status }),
      ...(sample.error === undefined ? {} : { error: sample.error }),
      spans: sample.spans,
      ...(sample.cut === undefined ? {} : { cut: sample.cut }),
      tree: packTree(sample.tree, position, undefined),
    }));
  }
  return packed;
};

export const packObserved = (
  observed: Observed,
  packedEdges: readonly GraphEdge[],
  entryIds: Readonly<Record<string, number>>,
  /** Every node's position in `nodes`, by id. */
  position: ReadonlyMap<string, number>,
  /** The nodes themselves, for what each way in declares it fails with (P106). */
  nodes: readonly GraphNode[] = [],
  traffic?: PackTraffic,
): PackedObserved => {
  const at = new Map(packedEdges.map((edge, index) => [joinIdOf(edge.from, edge.type, edge.to), index]));
  const joins: PackedObserved['joins'] = {};
  for (const [id, seen] of Object.entries(observed.joins)) {
    const index = at.get(id);
    if (index !== undefined) {
      joins[String(index)] = {
        count: seen.count,
        lastSeen: seen.lastSeen,
        ...statsOf(seen),
        ...(seen.measuredAt === undefined ? {} : { measuredAt: seen.measuredAt }),
      };
    }
  }
  const entries: PackedObserved['entries'] = {};
  const failures: Record<string, PackedFailuresSeen> = {};
  for (const [id, seen] of Object.entries(observed.entries)) {
    const at = entryIds[id];
    if (at === undefined) continue;
    entries[id] = { hits: seen.hits, ...statsOf(seen) };
    const node = nodes[at];
    const compared =
      node?.id !== id
        ? undefined
        : compareEntryFailures(
            node,
            { count: seen.hits, ...(seen.statuses === undefined ? {} : { statuses: seen.statuses }) },
            { window: observed.window },
          );
    if (comparisonSays(compared)) {
      const { entry: _entry, ...rest } = compared;
      failures[id] = rest;
    }
  }
  // A step's own figures, for one no join into it measured (P111).
  const own: Record<string, PackedStats> = {};
  for (const rows of [observed.symbols ?? {}, observed.channels ?? {}]) {
    for (const [id, seen] of Object.entries(rows)) {
      const place = position.get(id);
      const stats = place === undefined ? undefined : ownStatsOf(seen);
      if (stats !== undefined && own[String(place)] === undefined) own[String(place)] = stats;
    }
  }
  const samples = packSamples(observed.samples, entryIds, position);
  const ambiguousIn = observed.ambiguous ?? [];
  const rows = [...observed.unmatched, ...ambiguousIn];
  const services = wordsOf(
    rows.flatMap(({ service }) => (service === undefined ? [] : [service])),
    'services',
  );
  const kinds = wordsOf(rows.map(({ kind }) => kind), 'kinds');
  const serviceWord = (service: string | undefined): Word => (service === undefined ? -1 : services.word(service));
  const unmatched = observed.unmatched.map(({ service, kind, name }): PackedObserved['unmatched'][number] =>
    traffic === undefined
      ? [serviceWord(service), kinds.word(kind), name]
      : [serviceWord(service), kinds.word(kind), name, blindSpotNext(kind, name, service)],
  );
  const blind = (traffic?.blind ?? []).map((row): [string, string, string] => [row.service ?? '', row.level, row.message]);
  const neverRows = (traffic?.never.rows ?? []).flatMap((row): Array<[number, 0 | 1]> => {
    const place = position.get(row.id);
    return place === undefined ? [] : [[place, row.confidence === 'strong' ? 1 : 0]];
  });
  const confirmed = (traffic?.confirmed ?? []).flatMap((id) => {
    const place = at.get(id);
    return place === undefined ? [] : [place];
  });
  const drift: Record<string, [number, string[]]> = {};
  for (const row of traffic?.drift ?? []) if (entryIds[row.entry] !== undefined && row.fields > 0) drift[row.entry] = [row.fields, [...row.paths]];
  const ambiguous = ambiguousIn.map(({ service, kind, name, count, candidates, more }): PackedAmbiguous => {
    const places = candidates.flatMap((id) => {
      const place = kind === 'join' ? at.get(id) : position.get(id);
      return place === undefined ? [] : [place];
    });
    const unnamed = (more ?? 0) + candidates.length - places.length;
    const row: PackedAmbiguous = [serviceWord(service), kinds.word(kind), name, count, places];
    if (unnamed > 0) row.push(unnamed);
    return row;
  });
  return {
    joins,
    entries,
    ...(Object.keys(own).length === 0 ? {} : { nodes: own }),
    ...(Object.keys(samples).length === 0 ? {} : { samples }),
    ...(observed.window === undefined || observed.window.from === null ? {} : { window: observed.window }),
    ...(Object.keys(failures).length === 0 ? {} : { failures }),
    unmatched,
    ...(traffic === undefined ? {} : { never: { window: traffic.never.window, rows: neverRows } }),
    ...(confirmed.length === 0 ? {} : { confirmed }),
    ...(Object.keys(drift).length === 0 ? {} : { drift }),
    ...(ambiguous.length === 0 ? {} : { ambiguous }),
    ...(services.list.length === 0 ? {} : { services: services.list }),
    ...(kinds.list.length === 0 ? {} : { kinds: kinds.list }),
    ...(blind.length === 0 ? {} : { blind }),
  };
};

/**
 * One row of the Run time changes tab (P111): the way in (`entry`, a node
 * position) or the join (`edge`, a position in `edges`) and both files'
 * figures, `a` first; null where a file did not measure it.
 */
export interface PackedDiffRow {
  entry?: number;
  edge?: number;
  count: [number, number];
  p95: [number | null, number | null];
  errorRate: [number | null, number | null];
  newStatuses?: string[];
}

/**
 * Two observed files compared (P111, `visualise --observed-diff`), over the
 * ids this graph still holds: `leftOut` counts the ids either file names that
 * it does not. The four lists are `diffObserved`'s, in its order.
 */
export interface PackedObservedDiff {
  names: [string, string];
  windows: [ObservedWindow | null, ObservedWindow | null];
  minCount: number;
  timed: [boolean, boolean];
  leftOut: number;
  tooFew: number;
  slower: PackedDiffRow[];
  failing: PackedDiffRow[];
  appeared: PackedDiffRow[];
  gone: PackedDiffRow[];
}

/** What the command read for `--observed-diff`: both files, what to call them, and the floor. */
export interface PackDiffInput {
  a: Observed;
  b: Observed;
  names: [string, string];
  minCount?: number;
}

export const packObservedDiff = (
  input: PackDiffInput,
  packedEdges: readonly GraphEdge[],
  entryIds: Readonly<Record<string, number>>,
): PackedObservedDiff => {
  const at = new Map(packedEdges.map((edge, index) => [joinIdOf(edge.from, edge.type, edge.to), index]));
  const left = new Set<string>();
  const keep = (kind: DiffKind, id: string): boolean => {
    const held = kind === 'entry' ? entryIds[id] !== undefined : at.has(id);
    if (!held) left.add(`${kind}:${id}`);
    return held;
  };
  const diff = diffObserved(input.a, input.b, { ...(input.minCount === undefined ? {} : { minCount: input.minCount }), keep });
  const rowOf = (row: ObservedDiffRow): PackedDiffRow => ({
    ...(row.kind === 'entry' ? { entry: entryIds[row.id]! } : { edge: at.get(row.id)! }),
    count: row.count,
    p95: [row.p95[0] ?? null, row.p95[1] ?? null],
    errorRate: [row.errorRate[0] ?? null, row.errorRate[1] ?? null],
    ...(row.newStatuses.length === 0 ? {} : { newStatuses: row.newStatuses }),
  });
  return {
    names: input.names,
    windows: diff.windows,
    minCount: diff.minCount,
    timed: diff.timed,
    leftOut: left.size,
    tooFew: diff.tooFew,
    slower: diff.slower.map(rowOf),
    failing: diff.failing.map(rowOf),
    appeared: diff.appeared.map(rowOf),
    gone: diff.gone.map(rowOf),
  };
};
