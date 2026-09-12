/**
 * Who would notice, for every node a revision changed.
 *
 * The walk is the reader's own recursive query read backwards; nothing here
 * traverses anything itself. What this adds is the part a blast radius needs
 * and a reachability sweep does not: the ways in grouped by service and kind,
 * the weakest hop on the way, and a bound that cuts the list without inventing
 * a count.
 */
import { strongerConfidence, type Confidence } from '@flowatlas/core';
import type { GraphDb, TraverseRow } from '../db/reader.js';
import type { BlastEntry, BlastOptions, BlastRadius, BlastRow } from './types.js';

/**
 * Edges a blast radius follows backwards.
 *
 * The reader's forward list plus `guarded_by`: a guard that changed protects
 * every route hung off it, and walking in from one is the only way to say which.
 * `injects` is deliberately absent — see `PROVIDER_EDGES`.
 */
export const BLAST_EDGES = [
  'handles',
  'calls',
  'queries',
  'caches',
  'emits',
  'consumes',
  'http_calls',
  'hits',
  'triggers',
  'reads_config',
  'guarded_by',
] as const;

/**
 * The same list plus `injects`, used only when the changed node is a provider.
 *
 * A provider whose shape changed is held by controllers that may never call it
 * through an edge anything could resolve, and those controllers are in the
 * radius. Following `injects` from anywhere else would pull every holder of
 * every provider on the path into the answer, which is how an impact count
 * stops meaning anything.
 */
export const PROVIDER_EDGES = [...BLAST_EDGES, 'injects'] as const;

/** Node types that count as a way in. A button is one; the plan says so. */
const WAYS_IN = new Set(['entry', 'ui_action']);

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** How a way in is named in a count: an entry by its kind, a button by its type. */
const kindOf = (row: { type: string; kind: string | null }): string =>
  row.type === 'ui_action' ? 'ui_action' : (row.kind ?? 'http');

const asConfidence = (value: string | null): Confidence =>
  value === 'marker' || value === 'heuristic' || value === 'runtime' ? value : 'static';

/** The weakest of two, which is all a chain of them is worth. */
const weaker = (a: Confidence, b: Confidence): Confidence =>
  strongerConfidence(a, b) === a ? b : a;

const parentPath = (path: string): string => path.slice(0, path.lastIndexOf('>'));

/**
 * The weakest hop on the way to each row, carried down the walk.
 *
 * The reader hands back one row per distinct path with the edge that led there,
 * so the minimum along a path is the minimum of its parent's and its own. Rows
 * arrive shallowest first, which is what makes one pass enough.
 */
const confidenceByPath = (rows: readonly TraverseRow[]): Map<string, Confidence> => {
  const found = new Map<string, Confidence>();
  for (const row of rows) {
    if (row.depth === 0) {
      found.set(row.path, 'static');
      continue;
    }
    const above = found.get(parentPath(row.path)) ?? 'static';
    found.set(row.path, weaker(above, asConfidence(row.confidence)));
  }
  return found;
};

interface Collected {
  entries: Map<string, BlastEntry>;
  services: Set<string>;
  entryServices: Set<string>;
  reached: Set<string>;
}

const collect = (rows: readonly TraverseRow[]): Collected => {
  const confidence = confidenceByPath(rows);
  const entries = new Map<string, BlastEntry>();
  const services = new Set<string>();
  const entryServices = new Set<string>();
  const reached = new Set<string>();

  for (const row of rows) {
    if (row.depth === 0) continue;
    reached.add(row.id);
    const service = row.service ?? '';
    services.add(service);
    if (!WAYS_IN.has(row.type)) continue;
    entryServices.add(service);

    const found = confidence.get(row.path) ?? 'static';
    const already = entries.get(row.id);
    if (already === undefined) {
      entries.set(row.id, {
        id: row.id,
        service,
        kind: kindOf(row),
        type: row.type,
        label: row.label,
        file: row.file,
        line: row.line,
        depth: row.depth,
        confidence: found,
      });
      continue;
    }
    // Two ways round to the same button. It is as reachable as the better of
    // them, and as near as the shorter of them.
    already.confidence = strongerConfidence(already.confidence, found);
    already.depth = Math.min(already.depth, row.depth);
  }
  return { entries, services, entryServices, reached };
};

const countsOf = (entries: readonly BlastEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const key = `${entry.service}:${entry.kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => byText(a, b)));
};

/**
 * Nearest first, then by service and id.
 *
 * A reviewer reads the top of the list, so the top should be the ways in
 * closest to what changed.
 */
const order = (a: BlastEntry, b: BlastEntry): number =>
  a.depth - b.depth || byText(a.service, b.service) || byText(a.id, b.id);

/**
 * Every way in that reaches each of these nodes.
 *
 * `side` only labels the answer: a caller diffing two revisions asks the head
 * graph about what changed and the base graph about what was removed, since
 * nothing in the head reaches a node the head no longer has.
 */
export const blastRadius = (
  store: GraphDb,
  nodeIds: readonly string[],
  options: BlastOptions & { side?: 'head' | 'base' } = {},
): BlastRadius => {
  const maxEntries = options.maxEntries ?? 150;
  const maxDepth = options.maxDepth ?? 16;
  const maxWalk = options.maxWalk ?? 4000;
  const side = options.side ?? 'head';

  const rows: BlastRow[] = nodeIds.map((id) => {
    const node = store.node(id);
    const edgeTypes = node?.type === 'provider' ? PROVIDER_EDGES : BLAST_EDGES;
    const walk =
      node === undefined
        ? { rows: [], truncated: false }
        : store.traverse({ from: id, direction: 'in', edgeTypes, maxDepth, maxNodes: maxWalk });

    const found = collect(walk.rows);
    const all = [...found.entries.values()].sort(order);
    const services = new Set(found.services);
    if (node !== undefined) services.add(node.repo);

    return {
      node: id,
      service: node?.repo ?? '',
      label: node?.label ?? id,
      side,
      entries: all.slice(0, maxEntries),
      counts: countsOf(all),
      truncated: Math.max(all.length - maxEntries, 0),
      services: [...services].filter((name) => name !== '').sort(byText),
      servicesWithoutEntry: [...services]
        .filter((name) => name !== '' && name !== node?.repo && !found.entryServices.has(name))
        .sort(byText),
      reached: found.reached.size,
      partial: walk.truncated,
    };
  });

  return { rows, maxEntries };
};
