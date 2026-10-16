import type { GraphEdge } from '@flowatlas/core';

/**
 * What the Steps view needs of each edge beyond its two ends: where it sits
 * among its siblings, whether it runs only on a failure, and whether it runs
 * beside its siblings rather than after them (P64).
 *
 * `order` is one number per packed edge: the place a workflow gives the step
 * (`meta.order`), or else the line of the call, or 0 when neither is known.
 * `failure` and `concurrent` list packed edge positions.
 */
export interface PackedSites {
  order: number[];
  failure: number[];
  concurrent: number[];
  /**
   * Edges run once per item of a loop (P69), as `[edge, kind, line]`: the
   * loop's kind as the code writes it (`for-of`, `map`) and the line it opens on.
   */
  loop: Array<[number, string, number]>;
}

type Transition = { kind?: unknown };

const transitionsOf = (edge: GraphEdge): Transition[] => {
  const list = edge.meta?.['transitions'];
  return Array.isArray(list) ? (list as Transition[]) : [];
};

/** A transition a workflow takes only when the step before it fails. */
const FAILING_TRANSITIONS: ReadonlySet<unknown> = new Set(['catch']);

/** A transition into a branch run beside the others: a parallel branch, a map's items. */
const SIDE_BY_SIDE: ReadonlySet<unknown> = new Set(['branch', 'item-processor']);

const isFailure = (edge: GraphEdge): boolean =>
  edge.meta?.['when'] === 'failure' || transitionsOf(edge).some((t) => FAILING_TRANSITIONS.has(t.kind));

const isDeclaredConcurrent = (edge: GraphEdge): boolean =>
  edge.meta?.['concurrent'] === true ||
  edge.meta?.['parallel'] === true ||
  transitionsOf(edge).some((t) => SIDE_BY_SIDE.has(t.kind));

const loopOf = (edge: GraphEdge): [string, number] | undefined => {
  const loop = edge.meta?.['inLoop'] as { kind?: unknown; line?: unknown } | undefined;
  if (loop === undefined || typeof loop.kind !== 'string') return undefined;
  return [loop.kind, typeof loop.line === 'number' ? loop.line : 0];
};

const orderOf = (edge: GraphEdge): number => {
  const order = edge.meta?.['order'];
  if (typeof order === 'number' && Number.isFinite(order)) return order;
  return edge.line ?? 0;
};

/**
 * Sites of the edges the pack keeps, in the pack's order. Running beside the
 * siblings is what the graph declares - a workflow's parallel branches and
 * map items, an edge marked `concurrent` or `parallel` - and nothing more: two
 * calls on one line are as often `a(b())` as `Promise.all([a(), b()])`, and
 * the line alone cannot tell them apart.
 */
export const packSites = (edges: readonly GraphEdge[]): PackedSites => {
  const order = edges.map(orderOf);
  const failure: number[] = [];
  const concurrent: number[] = [];
  const loop: PackedSites['loop'] = [];
  edges.forEach((edge, k) => {
    if (isFailure(edge)) failure.push(k);
    if (isDeclaredConcurrent(edge)) concurrent.push(k);
    const inLoop = loopOf(edge);
    if (inLoop !== undefined) loop.push([k, ...inLoop]);
  });
  return { order, failure, concurrent, loop };
};
