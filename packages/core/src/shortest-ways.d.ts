/**
 * Types for `shortest-ways.js`: the shortest ways from one node to another,
 * asked by the page's path finder, `flowatlas path` and `get_flow` with `to`
 * alike (P229).
 */

export declare const PATH_DEPTHS: readonly number[];
export declare const DEFAULT_PATH_DEPTH: number;
export declare const DEFAULT_PATH_CAP: number;

export interface ShortestWaysOptions<N, E> {
  from: N;
  to: N;
  /** The nodes one step from `u`, with the edge taken: along the edges when `forward`, against them otherwise. */
  moves: (u: N, forward: boolean) => Iterable<readonly [N, E]>;
  /** The order two nodes are listed in for a person, at the same distance. */
  named: (a: N, b: N) => number;
  /** Most steps looked along; `DEFAULT_PATH_DEPTH` when absent. */
  depth?: number;
  /** Most nodes kept; `DEFAULT_PATH_CAP` when absent. */
  cap?: number;
}

/** One step along a shortest path between two kept nodes. */
export interface WayStep<N, E> {
  from: N;
  to: N;
  edge: E;
}

export interface ShortestWays<N, E> {
  found: boolean;
  /** Steps on a shortest path; null when none was found. */
  length: number | null;
  /** How many shortest paths there are. */
  paths: number;
  /** Nodes reached looking. */
  searched: number;
  /** The depth looked along. */
  depth: number;
  /** Every node on some shortest path, nearest `from` first. */
  onPath: N[];
  /** The nodes kept, at most the cap, one whole path first when cut. */
  kept: N[];
  /** Each kept node's distance from `from`. */
  layer: Map<N, number>;
  /** The edges between kept nodes along a shortest path. */
  edges: E[];
  steps: WayStep<N, E>[];
  /** For each kept node but `from`, the kept node it was first reached from. */
  parent: Map<N, N>;
  /** Nodes on a shortest path that were not kept. */
  left: number;
}

export declare const shortestWays: <N, E>(options: ShortestWaysOptions<N, E>) => ShortestWays<N, E>;
