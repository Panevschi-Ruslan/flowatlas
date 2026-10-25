/**
 * What an edge says about when and how often it runs (P64, P69): only when the
 * step before it fails, beside its siblings, or once per item of a loop.
 *
 * Read by the page's packer (`sites.ts`) and by the MCP server's prompt, which
 * mark the same steps the same way (P97), so the rule is written once here.
 */
import type { GraphEdge } from './model/edges.js';

type Transition = { kind?: unknown };

const transitionsOf = (edge: Pick<GraphEdge, 'meta'>): Transition[] => {
  const list = edge.meta?.['transitions'];
  return Array.isArray(list) ? (list as Transition[]) : [];
};

/** A transition a workflow takes only when the step before it fails. */
const FAILING_TRANSITIONS: ReadonlySet<unknown> = new Set(['catch']);

/** A transition into a branch run beside the others: a parallel branch, a map's items. */
const SIDE_BY_SIDE: ReadonlySet<unknown> = new Set(['branch', 'item-processor']);

/** Whether an edge runs only when the step before it fails: a failure destination, a workflow's catch. */
export const runsOnFailure = (edge: Pick<GraphEdge, 'meta'>): boolean =>
  edge.meta?.['when'] === 'failure' || transitionsOf(edge).some((t) => FAILING_TRANSITIONS.has(t.kind));

/**
 * Whether an edge runs beside its siblings: what the graph declares - a
 * workflow's parallel branches and map items, an edge marked `concurrent` or
 * `parallel` - and nothing more. Two calls on one line are as often `a(b())`
 * as `Promise.all([a(), b()])`, and the line alone cannot tell them apart.
 */
export const runsBeside = (edge: Pick<GraphEdge, 'meta'>): boolean =>
  edge.meta?.['concurrent'] === true ||
  edge.meta?.['parallel'] === true ||
  transitionsOf(edge).some((t) => SIDE_BY_SIDE.has(t.kind));

/** The loop an edge runs once per item of (P69): its kind as the code writes it and the line it opens on. */
export const loopOfEdge = (edge: Pick<GraphEdge, 'meta'>): { kind: string; line: number } | undefined => {
  const loop = edge.meta?.['inLoop'] as { kind?: unknown; line?: unknown } | undefined;
  if (loop === undefined || typeof loop.kind !== 'string') return undefined;
  return { kind: loop.kind, line: typeof loop.line === 'number' ? loop.line : 0 };
};

/** Where an edge sits among its siblings: the place a workflow gives it, else the line of the call, else 0. */
export const siteOrderOf = (edge: Pick<GraphEdge, 'meta' | 'line'>): number => {
  const order = edge.meta?.['order'];
  if (typeof order === 'number' && Number.isFinite(order)) return order;
  return edge.line ?? 0;
};

/** Whether the place an edge sits at is a workflow's (`meta.order`) rather than a line. */
export const hasSiteOrder = (edge: Pick<GraphEdge, 'meta'>): boolean => typeof edge.meta?.['order'] === 'number';
