/**
 * Types for `graph.js`, which stays plain JavaScript because the page runs its
 * text as it is. Only the test reads these.
 */
import type { PackedGraph } from './pack.js';

export declare const FIELD: Readonly<{
  type: 0;
  label: 1;
  repo: 2;
  kind: 3;
  file: 4;
  line: 5;
  meta: 6;
}>;
export declare const EDGE: Readonly<{ from: 0; to: 1; type: 2; confidence: 3 }>;
export declare const ROW: Readonly<{
  node: 0;
  repo: 1;
  file: 2;
  line: 3;
  reason: 4;
  level: 5;
  sites: 6;
  message: 7;
  hint: 8;
}>;

export interface GraphModel {
  data: Pick<PackedGraph, 'nodes' | 'edges' | 'dicts'> & Partial<Pick<PackedGraph, 'rows'>>;
  nodes: unknown[][];
  edges: number[][];
  outgoing: number[][];
  incoming: number[][];
  rowsOn: Map<number, number[]>;
  rowsInFile: Map<string, number[]>;
  haystack: string[] | null;
}

export interface GraphFilter {
  node(index: number): boolean;
  edge(index: number): boolean;
  active: boolean;
}

export interface Hidden {
  services?: Set<number>;
  edgeTypes?: Set<number>;
  confidences?: Set<number>;
}

export interface Neighbourhood {
  focus: number;
  hops: number;
  cap: number;
  nodes: number[];
  layer: Map<number, number>;
  edges: number[];
  more: Map<number, number>;
  left: number;
  reached: number;
}

export interface Placed {
  pos: Map<number, { x: number; y: number; layer: number; row: number }>;
  columns: Map<number, number[]>;
  links: Map<number, Set<number>>;
  min: number;
  max: number;
  width: number;
  height: number;
}

export interface History {
  current(): number | null;
  visit(focus: number): void;
  back(): number | null;
  forward(): number | null;
  canBack(): boolean;
  canForward(): boolean;
}

export declare const ALL: GraphFilter;
export declare const HOPS: readonly number[];
export declare const createModel: (data: GraphModel['data']) => GraphModel;
export declare const createFilter: (model: GraphModel, hidden?: Hidden) => GraphFilter;
export declare const neighbours: (
  model: GraphModel,
  filter: GraphFilter,
  node: number,
  direction: 'in' | 'out' | 'both',
) => Array<{ node: number; side: 1 | -1 }>;
export declare const neighbourhood: (
  model: GraphModel,
  options: { focus: number; hops?: number; cap?: number; filter?: GraphFilter; expanded?: number[] },
) => Neighbourhood;
export declare const layout: (
  model: GraphModel,
  hood: Neighbourhood,
  size?: { column?: number; row?: number },
) => Placed;
export declare const step: (placed: Placed, from: number, direction: 'up' | 'down' | 'left' | 'right') => number;
export declare const search: (model: GraphModel, query: string, limit?: number) => { total: number; hits: number[] };
export declare const describe: (
  model: GraphModel,
  node: number,
) => {
  into: Array<{ type: number; edges: number[] }>;
  out: Array<{ type: number; edges: number[] }>;
  rows: number[];
  inFile: number[];
};
export declare const createHistory: (limit?: number) => History;
export declare const parseHash: (hash: string, size: number) => { focus: number; hops: number | null } | null;
export declare const formatHash: (focus: number, hops: number) => string;
