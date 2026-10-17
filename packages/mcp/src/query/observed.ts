import { statSync } from 'node:fs';
import { joinIdOf, observedPathFor, readObserved, type AmbiguousSpan } from '@flowatlas/core';
import type { FlowNode } from './types.js';

export { joinIdOf, OBSERVED_FILE } from '@flowatlas/core';

/**
 * What `flowatlas observe` wrote beside the database (P65), as far as a tool
 * reads it: how often real traffic went through a join, an entry, a symbol or
 * a channel, and what it could not single out (P85). The file's contract is
 * core's `readObserved`; this keeps the counts and nothing else, so a newer
 * field there costs nothing here.
 */
export interface ObservedCounts {
  joins: Record<string, { count: number }>;
  entries: Record<string, { hits: number }>;
  symbols: Record<string, { hits: number }>;
  channels: Record<string, { hits: number }>;
  ambiguous: readonly AmbiguousSpan[];
  /** How many requests named an id (node or join) as one of the places they could be. */
  candidates: ReadonlyMap<string, number>;
}

const cache = new Map<string, { mtime: number; counts: ObservedCounts | undefined }>();

const candidatesOf = (ambiguous: readonly AmbiguousSpan[]): Map<string, number> => {
  const found = new Map<string, number>();
  for (const row of ambiguous) {
    for (const id of row.candidates) found.set(id, (found.get(id) ?? 0) + row.count);
  }
  return found;
};

/** The counts beside a database, or none; reread only when the file changes. Versions 1 and 2 are read. */
export const loadObservedCounts = (dbPath: string): ObservedCounts | undefined => {
  const path = observedPathFor(dbPath);
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
  const held = cache.get(path);
  if (held !== undefined && held.mtime === mtime) return held.counts;
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
        };
  cache.set(path, { mtime, counts });
  return counts;
};

/** How often a node itself was seen: an entry hit, a symbol named, a channel used. */
export const nodeSeen = (counts: ObservedCounts, id: string): number | undefined =>
  counts.entries[id]?.hits ?? counts.symbols[id]?.hits ?? counts.channels[id]?.hits;

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

const seenOn = (
  counts: ObservedCounts,
  parent: string,
  item: FlowNode,
  direction: TreeDirection,
): number | undefined => {
  const join = joinInto(parent, item, direction);
  const count = join === undefined ? undefined : counts.joins[join]?.count;
  return count ?? nodeSeen(counts, item.node.id);
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
 * and `seenAmbiguous: n` on a row that requests could have been but were not
 * counted on, because they fit other places as well.
 *
 * The edge into a row first, since that is the join the row stands for; the
 * row's own hits when the edge was not seen by name. A row nothing saw stays
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
      if (seen !== undefined) item.observed = seen;
      const unsure = nodeAmbiguous(counts, item.node.id, joinInto(parent, item, direction));
      if (unsure !== undefined) item.seenAmbiguous = unsure;
    }
    markObserved(counts, item.node.id, item.children, direction);
  }
};
