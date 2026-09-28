import type { GraphBuilder } from '../builder.js';
import { makeSymbolId } from '../ids.js';
import type { NodeType } from '../model/nodes.js';

/**
 * Which part of the chain in front of an entry point something is.
 *
 * Every one of them is also a node type, because what runs in front of a way in
 * is a thing in its own right and not an attribute of the way in: a reader may
 * ask which routes it stands in front of, what it reads, and what else reaches
 * it. That is the whole reason this is drawn as an edge (R109).
 */
export const WRAPPING_LAYERS = [
  'middleware',
  'guard',
  'interceptor',
  'pipe',
] as const satisfies readonly NodeType[];

export type WrappingLayer = (typeof WRAPPING_LAYERS)[number];

/**
 * How specific the attachment is: from the whole application to one route.
 *
 * Kept as one closed list for every reader, so that a chain read off a
 * declaration and a chain read off an installation can be compared at all.
 */
export const WRAPPING_SCOPES = ['global', 'prefix', 'class', 'method', 'route'] as const;

export type WrappingScope = (typeof WRAPPING_SCOPES)[number];

/**
 * Something that runs in front of an entry point, as the reader found it.
 *
 * A description rather than a node and an edge: an adapter says what it read and
 * stops there, exactly as it does for the handler, and `addEntryWrapping` below
 * is the single place that decides what that becomes in the graph.
 */
export interface EntryWrapping {
  /** How a reader knows it: the name as written, or the file that holds it. */
  label: string;
  layer: WrappingLayer;
  scope: WrappingScope;
  /** How it was attached — the call or the declaration that put it there. */
  source: string;
  /** Repo-relative POSIX path of the place the attachment is written. */
  file: string;
  line?: number;
  /** Sub-classification of the node, e.g. `function`, `class` or `file`. */
  kind?: string;
}

/** One wrapping, once its node is known. */
export interface AppliedWrapping {
  nodeId: string;
  layer: WrappingLayer;
  scope: WrappingScope;
  source: string;
  file?: string;
  line?: number;
}

/**
 * Draws a chain in front of one entry point, in the order it runs.
 *
 * The order is the whole of it — an answer to "why did this return 403" is a
 * position in this chain and nothing else — and it lives in `meta.order`
 * because an edge has no position of its own. The list handed in is already in
 * the order the framework applies.
 *
 * The same wrapper may be attached more than once, globally and again on one
 * route, and it really does run twice. An edge is identified by its endpoints,
 * so every application it stands for is listed on it under `applications`
 * rather than lost, and the first is the one the edge itself reports.
 *
 * A hole in the list is a wrapper that runs and could not be named. It keeps
 * its place, because the positions of everything after it are what the chain
 * is, and shifting them up would report the wrong answer to the only question
 * `order` is asked.
 *
 * One function for every reader, because two readers that spell this edge
 * differently are two shapes again, which is the defect this exists to close.
 */
export const addWrappingEdges = (
  builder: GraphBuilder,
  entryId: string,
  applied: ReadonlyArray<AppliedWrapping | undefined>,
): void => {
  const perTarget = new Map<string, { first: AppliedWrapping; orders: Array<{ order: number; scope: string; source: string }> }>();
  applied.forEach((one, order) => {
    if (one === undefined) return;
    const seen = perTarget.get(one.nodeId);
    const at = { order, scope: one.scope, source: one.source };
    if (seen === undefined) perTarget.set(one.nodeId, { first: one, orders: [at] });
    else seen.orders.push(at);
  });

  for (const [nodeId, { first, orders }] of perTarget) {
    const at = orders[0];
    if (at === undefined) continue;
    builder.addEdge({
      from: entryId,
      to: nodeId,
      type: 'guarded_by',
      confidence: 'static',
      ...(first.file === undefined ? {} : { file: first.file }),
      ...(first.line === undefined ? {} : { line: first.line }),
      meta: {
        order: at.order,
        scope: at.scope,
        layer: first.layer,
        source: at.source,
        ...(orders.length > 1 ? { applications: orders } : {}),
      },
    });
  }
};

/**
 * Turns what an adapter read in front of a way in into nodes and edges.
 *
 * The node is keyed by where the attachment is written and by how it is
 * spelled, which is the same key the wrapper of a class-based framework gets,
 * so a chain installed by a call and a chain declared by a decorator land on
 * the same shape. A name is all there is to go on for middleware written in
 * place, and two of them written identically in one file therefore share a
 * node — a cost of the shape, stated here rather than discovered.
 *
 * A wrapping with nothing to call it gets no node — an id needs a symbol, and a
 * node labelled with the empty string is not something a reader can act on —
 * but it keeps its place in the chain, so the order of the rest stays true.
 */
export const addEntryWrapping = (
  builder: GraphBuilder,
  repo: string,
  entryId: string,
  wrapping: readonly EntryWrapping[],
): void => {
  const applied: Array<AppliedWrapping | undefined> = [];
  for (const one of wrapping) {
    if (one.label === '' || one.file === '') {
      applied.push(undefined);
      continue;
    }
    const node = builder.addNode({
      id: makeSymbolId(repo, one.file, one.label),
      type: one.layer,
      label: one.label,
      repo,
      file: one.file,
      ...(one.line === undefined ? {} : { line: one.line }),
      ...(one.kind === undefined ? {} : { kind: one.kind }),
    });
    applied.push({
      nodeId: node.id,
      layer: one.layer,
      scope: one.scope,
      source: one.source,
      file: one.file,
      ...(one.line === undefined ? {} : { line: one.line }),
    });
  }
  addWrappingEdges(builder, entryId, applied);
};
