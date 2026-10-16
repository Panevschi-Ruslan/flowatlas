import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FlowNode } from './types.js';

/**
 * What `flowatlas observe` wrote beside the database (P65), as far as a tool
 * reads it: how often real traffic went through a join, an entry, a symbol or
 * a channel. The file's owner is the CLI; this reads the counts and nothing
 * else, so a newer field there costs nothing here.
 */
export interface ObservedCounts {
  joins: Record<string, { count: number }>;
  entries: Record<string, { hits: number }>;
  symbols: Record<string, { hits: number }>;
  channels: Record<string, { hits: number }>;
}

export const OBSERVED_FILE = 'observed.json';
const OBSERVED_FORMAT_VERSION = 1;

/** The same id `flowatlas observe` keys a join by. */
export const joinIdOf = (from: string, type: string, to: string): string => `${from} -${type}-> ${to}`;

const record = (value: unknown): Record<string, never> =>
  value !== null && typeof value === 'object' ? (value as Record<string, never>) : {};

const cache = new Map<string, { mtime: number; counts: ObservedCounts | undefined }>();

/** The counts beside a database, or none; reread only when the file changes. */
export const loadObservedCounts = (dbPath: string): ObservedCounts | undefined => {
  const path = join(dirname(dbPath), OBSERVED_FILE);
  if (!existsSync(path)) return undefined;
  const mtime = statSync(path).mtimeMs;
  const held = cache.get(path);
  if (held !== undefined && held.mtime === mtime) return held.counts;
  let counts: ObservedCounts | undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    counts =
      parsed['observedFormatVersion'] === OBSERVED_FORMAT_VERSION
        ? {
            joins: record(parsed['joins']),
            entries: record(parsed['entries']),
            symbols: record(parsed['symbols']),
            channels: record(parsed['channels']),
          }
        : undefined;
  } catch {
    counts = undefined;
  }
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

const seenOn = (
  counts: ObservedCounts,
  parent: string,
  item: FlowNode,
  direction: TreeDirection,
): number | undefined => {
  if (item.edge !== undefined) {
    const [from, to] = direction === 'forward' ? [parent, item.node.id] : [item.node.id, parent];
    const join = counts.joins[joinIdOf(from, item.edge.type, to)]?.count;
    if (join !== undefined) return join;
  }
  return nodeSeen(counts, item.node.id);
};

/**
 * Sets `observed: n` on every row of a tree that real traffic went through.
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
    }
    markObserved(counts, item.node.id, item.children, direction);
  }
};
