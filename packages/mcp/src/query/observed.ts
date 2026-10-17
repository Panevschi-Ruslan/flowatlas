import { statSync } from 'node:fs';
import {
  compareEntryFailures,
  joinIdOf,
  observedPathFor,
  readObserved,
  type AmbiguousSpan,
  type FailureComparison,
  type GraphNode,
  type HitSeen,
  type Observed,
  type ObservedFigures,
  type ObservedWindow,
  type Seen,
} from '@flowatlas/core';
import type { FlowNode } from './types.js';

export { joinIdOf, OBSERVED_FILE } from '@flowatlas/core';

/**
 * What `flowatlas observe` wrote beside the database (P65), as far as a tool
 * reads it: how often real traffic went through a join, an entry, a symbol or
 * a channel, how long it took and how often it failed (P105), and what it
 * could not single out (P85). The file's contract is core's `readObserved`,
 * which reads formats 1 to 3 into format 3's shape; this keeps the roll-up
 * rows, so a newer field there costs nothing here.
 */
export interface ObservedCounts {
  joins: Record<string, Seen>;
  entries: Record<string, HitSeen>;
  symbols: Record<string, HitSeen>;
  channels: Record<string, HitSeen>;
  ambiguous: readonly AmbiguousSpan[];
  /** How many requests named an id (node or join) as one of the places they could be. */
  candidates: ReadonlyMap<string, number>;
  /** The hours the counts cover (P105): what "never seen" is said over (P106). */
  window: ObservedWindow;
}

const cache = new Map<string, { mtime: number; observed: Observed | undefined; counts: ObservedCounts | undefined }>();

const candidatesOf = (ambiguous: readonly AmbiguousSpan[]): Map<string, number> => {
  const found = new Map<string, number>();
  for (const row of ambiguous) {
    for (const id of row.candidates) found.set(id, (found.get(id) ?? 0) + row.count);
  }
  return found;
};

/** The file beside a database as read, cached by its timestamp. */
const held = (dbPath: string): { observed: Observed | undefined; counts: ObservedCounts | undefined } | undefined => {
  const path = observedPathFor(dbPath);
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
  const had = cache.get(path);
  if (had !== undefined && had.mtime === mtime) return had;
  const { observed } = readObserved(path);
  const counts =
    observed === undefined
      ? undefined
      : {
          joins: observed.joins,
          entries: observed.entries,
          symbols: observed.symbols,
          channels: observed.channels,
          ambiguous: observed.ambiguous,
          candidates: candidatesOf(observed.ambiguous),
          window: observed.window,
        };
  const read = { mtime, observed, counts };
  cache.set(path, read);
  return read;
};

/** The counts beside a database, or none; reread only when the file changes. Versions 1 to 3 are read. */
export const loadObservedCounts = (dbPath: string): ObservedCounts | undefined => held(dbPath)?.counts;

/**
 * The whole file beside a database (P105): the roll-up with its figures, the
 * window and the samples. A version-1 or 2 file reads as one hour of counts
 * with no timings and no samples.
 */
export const loadObserved = (dbPath: string): Observed | undefined => held(dbPath)?.observed;

/** The figures a row shows beside `observed` (P105): the p95 and the error rate, each when measured. */
export const figuresOf = (seen: ObservedFigures | undefined): { p95?: number; errorRate?: number } =>
  seen === undefined
    ? {}
    : {
        ...(seen.p95 === undefined ? {} : { p95: seen.p95 }),
        ...(seen.errorRate === undefined ? {} : { errorRate: seen.errorRate }),
      };

/** The roll-up row of a node itself: an entry hit, a symbol named, a channel used. */
export const nodeRow = (counts: ObservedCounts, id: string): HitSeen | undefined =>
  counts.entries[id] ?? counts.symbols[id] ?? counts.channels[id];

/** How often a node itself was seen: an entry hit, a symbol named, a channel used. */
export const nodeSeen = (counts: ObservedCounts, id: string): number | undefined => nodeRow(counts, id)?.hits;

/**
 * Which way an edge in a tree points, relative to the parent row.
 *
 * In `get_flow` a child is called by its parent; in `who_calls` a child calls
 * its parent. The join id is the same edge either way, read from its source.
 */
export type TreeDirection = 'forward' | 'backward';

/** The join a row stands for, read from its source whichever way the tree points. */
const joinInto = (parent: string, item: FlowNode, direction: TreeDirection): string | undefined => {
  if (item.edge === undefined) return undefined;
  const [from, to] = direction === 'forward' ? [parent, item.node.id] : [item.node.id, parent];
  return joinIdOf(from, item.edge.type, to);
};

/** The count a row shows and the row it came from: the join into it, else the node's own. */
const seenOn = (
  counts: ObservedCounts,
  parent: string,
  item: FlowNode,
  direction: TreeDirection,
): { count: number; figures: ObservedFigures } | undefined => {
  const join = joinInto(parent, item, direction);
  const joined = join === undefined ? undefined : counts.joins[join];
  if (joined !== undefined) return { count: joined.count, figures: joined };
  const own = nodeRow(counts, item.node.id);
  return own === undefined ? undefined : { count: own.hits, figures: own };
};

/**
 * How many requests could have been this node, or the join into it, and were
 * counted on nothing because they fit other places as well (P85).
 */
export const nodeAmbiguous = (counts: ObservedCounts, id: string, join?: string): number | undefined => {
  const total = (counts.candidates.get(id) ?? 0) + (join === undefined ? 0 : (counts.candidates.get(join) ?? 0));
  return total > 0 ? total : undefined;
};

/**
 * Sets `observed: n` on every row of a tree that real traffic went through,
 * with `p95` and `errorRate` beside it where the file measured them (P105),
 * and `seenAmbiguous: n` on a row that requests could have been but were not
 * counted on, because they fit other places as well.
 *
 * The edge into a row first, since that is the join the row stands for; the
 * row's own hits when the edge was not seen by name. A row joined by a best
 * guess whose join was seen says `confirmedBy: 'traffic'` (P110). A row nothing saw stays
 * without the field rather than saying 0: a trace covers what was exercised,
 * and silence is not evidence of nothing.
 */
export const markObserved = (
  counts: ObservedCounts,
  parent: string,
  items: readonly FlowNode[],
  direction: TreeDirection,
): void => {
  for (const item of items) {
    if (item.node.ref !== true) {
      const seen = seenOn(counts, parent, item, direction);
      if (seen !== undefined) Object.assign(item, { observed: seen.count, ...figuresOf(seen.figures) });
      // A best guess traffic went through (P110): the join itself was seen, not just the node.
      const join = joinInto(parent, item, direction);
      if (item.edge?.confidence === 'heuristic' && join !== undefined && (counts.joins[join]?.count ?? 0) >= 1) item.confirmedBy = 'traffic';
      const unsure = nodeAmbiguous(counts, item.node.id, joinInto(parent, item, direction));
      if (unsure !== undefined) item.seenAmbiguous = unsure;
    }
    markObserved(counts, item.node.id, item.children, direction);
  }
};

/** Whether the observed file beside a database holds a sample request of an entry (P105). */
export const sampledIn =
  (dbPath: string) =>
  (id: string): boolean => {
    const samples = loadObserved(dbPath)?.samples[id];
    return samples !== undefined && samples.slow.length + samples.failing.length > 0;
  };

/**
 * What an entry answered at run time against what it declares (P106), over
 * the file's window; undefined for anything that is not an entry, an entry
 * nothing saw, or one whose spans carried no status.
 */
export const failuresSeen = (
  counts: ObservedCounts,
  node: Pick<GraphNode, 'id' | 'type' | 'meta'>,
  minHits?: number,
): FailureComparison | undefined => {
  const row = node.type === 'entry' ? counts.entries[node.id] : undefined;
  if (row === undefined) return undefined;
  return compareEntryFailures(
    node,
    { count: row.hits, ...(row.statuses === undefined ? {} : { statuses: row.statuses }) },
    { window: counts.window, ...(minHits === undefined ? {} : { minHits }) },
  );
};
