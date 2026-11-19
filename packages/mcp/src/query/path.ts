import { PATH_DEPTHS, shortestWays, type DetailLevel, type GraphEdge, type ShortestWays } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';
import { projectDetail, projectEdge } from './detail.js';
import { FORWARD_EDGES } from './flow.js';
import type { CompactNode, FlowNode } from './types.js';

/** How many nodes on a shortest path an answer keeps when nobody says. */
export const DEFAULT_PATH_NODES = 60;

export interface PathOptions {
  /** Along the edges the way the calls run (the default), or either way: "are these joined at all". */
  directed?: boolean;
  /** Steps looked along. Absent, `PATH_DEPTHS` are tried in turn until one finds a path. */
  depth?: number;
  /** Most nodes kept; one whole path first when cut. */
  maxNodes?: number;
  detail?: DetailLevel;
  /** Filled with the graph edge behind each row, as `buildFlowTree` fills it, for a sequence. */
  edgesOf?: Map<FlowNode, GraphEdge>;
}

/** The other way round, when it holds and the way asked for does not. */
export interface ReversePath {
  length: number;
  paths: number;
}

export interface PathResult {
  found: boolean;
  /** `from`, and under it the steps of every kept shortest path, in call order. */
  root: FlowNode;
  /** Steps on a shortest path; null when none was found. */
  length: number | null;
  /** How many shortest paths there are. */
  paths: number;
  /** Nodes reached looking. */
  searched: number;
  /** The depth looked along: the one asked for, or the first of `PATH_DEPTHS` that found it, or the last tried. */
  depth: number;
  /** Nodes on a shortest path the answer does not show. */
  left: number;
  /** Kept nodes something could not be read about, as `flow` counts them (P229 D4). */
  unresolvedOnPath: number;
  /** Present only when no path was found directed and `to` reaches `from`. */
  reverse?: ReversePath;
}

const missingNode = (id: string): CompactNode => ({ id, type: 'missing', label: id });

const byLine = (a: GraphEdge, b: GraphEdge): number =>
  (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0);

/** One search over the database, along the edges `flow` and `impact` walk. */
const search = (db: GraphDb, from: string, to: string, directed: boolean, depth: number, cap: number): ShortestWays<string, GraphEdge> => {
  const out = new Map<string, Array<readonly [string, GraphEdge]>>();
  const back = new Map<string, Array<readonly [string, GraphEdge]>>();
  const forward = (u: string): Array<readonly [string, GraphEdge]> => {
    let found = out.get(u);
    if (found === undefined) {
      found = db.edgesFrom(u, FORWARD_EDGES).filter((edge) => edge.to !== u).map((edge) => [edge.to, edge] as const);
      out.set(u, found);
    }
    return found;
  };
  const backward = (u: string): Array<readonly [string, GraphEdge]> => {
    let found = back.get(u);
    if (found === undefined) {
      found = db.edgesTo(u, FORWARD_EDGES).filter((edge) => edge.from !== u).map((edge) => [edge.from, edge] as const);
      back.set(u, found);
    }
    return found;
  };
  const label = (id: string): string => db.node(id)?.label ?? id;
  return shortestWays<string, GraphEdge>({
    from,
    to,
    moves: (u, ahead) => (!directed ? [...forward(u), ...backward(u)] : ahead ? forward(u) : backward(u)),
    named: (a, b) => {
      const la = label(a);
      const lb = label(b);
      return la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0;
    },
    depth,
    cap,
  });
};

/** The depths to try: the one asked for, or `PATH_DEPTHS` in turn. */
const depthsOf = (depth: number | undefined): readonly number[] => (depth === undefined ? PATH_DEPTHS : [depth]);

/**
 * How `from` reaches `to`, by the shortest ways (P229).
 *
 * The search is core's `shortestWays`, the one the page's path finder asks,
 * over the edges `flow` walks: directed, a path is how a request gets from one
 * to the other; undirected, it says whether they are joined at all. Without a
 * depth it looks along `PATH_DEPTHS` in turn, so a near path costs a near
 * search. With none found directed, the other way round is tried at the same
 * depth, since asking the wrong way round is the common mistake.
 *
 * The answer is a tree from `from` in the shape `get_flow` answers: each kept
 * node written once, met again under another step as a reference to where it
 * is (`seenAt`), children in the order their calls are written.
 */
export const findPath = (db: GraphDb, from: string, to: string, options: PathOptions = {}): PathResult => {
  const directed = options.directed !== false;
  const cap = options.maxNodes ?? DEFAULT_PATH_NODES;
  const detail = options.detail ?? 1;

  let ways: ShortestWays<string, GraphEdge> | undefined;
  for (const depth of depthsOf(options.depth)) {
    ways = search(db, from, to, directed, depth, cap);
    if (ways.found) break;
  }
  const found = ways as ShortestWays<string, GraphEdge>;

  const nodeOf = (id: string): CompactNode => {
    const node = db.node(id);
    return node === undefined ? missingNode(id) : projectDetail(node, detail);
  };
  const root: FlowNode = { node: nodeOf(from), children: [] };

  // Walked in call order, as `get_flow` writes a tree: a kept node's row is
  // under the step that reaches it first, and under any other a reference to
  // that row. Every step is one layer further from `from`, so each way to a
  // node is as long as the others and no cycle can be met.
  const childrenOf = new Map<string, Array<{ to: string; edge: GraphEdge }>>();
  for (const step of found.steps) {
    const list = childrenOf.get(step.from) ?? [];
    list.push({ to: step.to, edge: step.edge });
    childrenOf.set(step.from, list);
  }
  const placedUnder = new Map<string, string>();
  const visit = (u: string, row: FlowNode): void => {
    const steps = [...(childrenOf.get(u) ?? [])].sort((a, b) => byLine(a.edge, b.edge) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
    for (const { to: v, edge } of steps) {
      const seenAt = placedUnder.get(v);
      const child: FlowNode =
        seenAt === undefined
          ? { node: nodeOf(v), edge: projectEdge(edge, detail), children: [] }
          : { node: { id: v, type: 'ref', label: db.node(v)?.label ?? v, ref: true, seenAt }, edge: projectEdge(edge, detail), children: [] };
      options.edgesOf?.set(child, edge);
      row.children.push(child);
      if (seenAt === undefined) {
        placedUnder.set(v, u);
        visit(v, child);
      }
    }
  };
  placedUnder.set(from, from);
  visit(from, root);

  const unresolvedOnPath = found.kept.filter((id) => db.node(id) === undefined || db.unresolvedFor(id).length > 0).length;
  let reverse: ReversePath | undefined;
  if (!found.found && directed && from !== to) {
    const back = search(db, to, from, true, found.depth, cap);
    if (back.found && back.length !== null) reverse = { length: back.length, paths: back.paths };
  }
  return {
    found: found.found,
    root,
    length: found.length,
    paths: found.paths,
    searched: found.searched,
    depth: found.depth,
    left: found.left,
    unresolvedOnPath,
    ...(reverse === undefined ? {} : { reverse }),
  };
};
