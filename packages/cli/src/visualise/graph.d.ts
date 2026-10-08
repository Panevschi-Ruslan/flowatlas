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
  data: Pick<PackedGraph, 'nodes' | 'edges' | 'dicts'> & Partial<Pick<PackedGraph, 'rows' | 'steps' | 'shapes'>>;
  nodes: unknown[][];
  edges: number[][];
  outgoing: number[][];
  incoming: number[][];
  rowsOn: Map<number, number[]>;
  rowsInFile: Map<string, number[]>;
  haystack: string[] | null;
  owners: Map<number, string> | null;
  faces: Map<number, unknown[]> | null;
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

/** A node position, or a group's id when grouping is on. */
export type Unit = number | string;

export interface Group {
  id: string;
  /** `service` opens into classes, `class` into its nodes, `rest` into the next page. */
  level: 'service' | 'class' | 'rest';
  next: 'service' | 'class' | 'leaf';
  type: number;
  /** The service every member is in, or -1 when they are in several. */
  repo: number;
  owner: string | null;
  /** How many classes (or services) it holds. */
  parts: number;
  members: number[];
  side: 1 | -1;
  /** Nodes past it within the hops, not drawn while it is closed. */
  behind: number;
}

export interface Chip {
  open: boolean;
  layers: Array<[string, number]>;
  total: number;
}

/** Which way a node looks: the flow on, and who else uses it. */
export type Look = 'in' | 'out' | 'both';

/** A unit drawn as context: who else uses `of`, the way `look` says. */
export interface Context {
  of: number;
  look: 'in' | 'out';
}

export interface Neighbourhood {
  focus: number;
  hops: number;
  cap: number;
  nodes: Unit[];
  layer: Map<Unit, number>;
  /** The side of the focus each unit is drawn on. */
  side: Map<Unit, -1 | 0 | 1>;
  parent: Map<Unit, Unit>;
  edges: number[];
  bundles: Array<{ from: Unit; to: Unit; edges: number[] }>;
  groups: Map<string, Group>;
  chips: Map<number, Chip>;
  more: Map<number, number>;
  /** Who else uses a flow node, outside the flow, and whether it is drawn. */
  others: Map<number, { look: 'in' | 'out'; count: number; shown: boolean }>;
  context: Map<Unit, Context>;
  left: number;
  behind: number;
  reached: number;
}

export interface Placed {
  pos: Map<Unit, { x: number; y: number; layer: number; row: number }>;
  columns: Map<number, Unit[]>;
  links: Map<Unit, Set<Unit>>;
  lanes: Array<{ repo: number; y: number; rows: number; height: number }>;
  min: number;
  max: number;
  width: number;
  height: number;
}

export interface Fold {
  unfolded: Set<number>;
  walk(edge: number): boolean;
  edge(edge: number): boolean;
  chain(node: number): number[];
  chip(node: number): Chip | null;
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
export declare const createModel: (data: GraphModel['data']) => GraphModel;
export declare const createFilter: (model: GraphModel, hidden?: Hidden) => GraphFilter;
export declare const neighbours: (
  model: GraphModel,
  filter: GraphFilter,
  node: number,
  direction: 'in' | 'out' | 'both',
) => Array<{ node: number; side: 1 | -1 }>;
export declare const LOOK: Readonly<Record<-1 | 0 | 1, Readonly<{ flow: Look; also: 'in' | 'out' | null }>>>;
export declare const PLUMBING: readonly string[];
export declare const GROUPING: Readonly<{ at: number; page: number }>;
export declare const ownerOf: (model: GraphModel, node: number) => string;
export declare const labelParts: (model: GraphModel, node: number) => { name: string; owner: string };
export declare const middle: (text: string, chars: number) => string;
export declare const zoomLevel: (scale: number) => 'far' | 'mid' | 'near';
export declare const foldPlumbing: (
  model: GraphModel,
  options?: { focus?: number; draw?: boolean; unfolded?: Set<number>; filter?: GraphFilter },
) => Fold;
export declare const neighbourhood: (
  model: GraphModel,
  options: {
    focus: number;
    hops?: number;
    cap?: number;
    filter?: GraphFilter;
    expanded?: number[];
    also?: number[];
    fold?: { draw?: boolean; unfolded?: Set<number> } | false;
    group?: boolean | { at?: number; page?: number };
    opened?: Set<string>;
  },
) => Neighbourhood;
export declare const trace: (hood: Neighbourhood, target: Unit) => Unit[];
export declare const layout: (
  model: GraphModel,
  hood: Pick<Neighbourhood, 'focus' | 'nodes' | 'layer' | 'edges'> & Partial<Pick<Neighbourhood, 'bundles' | 'groups'>>,
  size?: { column?: number; row?: number; laneGap?: number; laneHead?: number },
) => Placed;
export declare const step: (placed: Placed, from: Unit, direction: 'up' | 'down' | 'left' | 'right') => Unit;
export declare const search: (model: GraphModel, query: string, limit?: number) => { total: number; hits: number[] };
export declare const describe: (
  model: GraphModel,
  node: number,
) => {
  into: Array<{ type: number; edges: number[] }>;
  out: Array<{ type: number; edges: number[] }>;
  rows: number[];
  atLine: number[];
  inFile: number[];
};
export declare const FACE: Readonly<{ node: 0; face: 1; params: 2; returns: 3 }>;
export declare const PARAM_FLAG: Readonly<{ none: 0; optional: 1; rest: 2; claimed: 3 }>;
export declare const CLAIMED_MARK: string;

export interface Face {
  face: 'method' | 'route' | 'call' | 'channel' | 'bare';
  /** `label` is '' for a parameter recorded without a name; `ref` indexes `shapes.refs`. */
  params: Array<{ label: string; ref: number; flag: number }>;
  /** A position in `shapes.refs`, or -1. */
  returns: number;
}

export interface TypeInfo {
  name: string;
  kind: string;
  declaredIn: string;
  fields: Array<{ name: string; ref: number; optional: boolean }>;
  members: Array<{ ref: number } | { text: string }>;
  typeParams: string[];
}

export declare const faceOf: (model: GraphModel, node: number) => Face | null;
export declare const refText: (model: GraphModel, ref: number) => string;
export declare const refParts: (model: GraphModel, ref: number) => Array<{ text: string; type?: number }>;
export declare const typeInfo: (model: GraphModel, type: number) => TypeInfo | null;
export declare const faceLine: (model: GraphModel, node: number) => string;

export declare const ANSWER: Readonly<{ node: 0; kind: 1; status: 2; ref: 3 }>;
export interface Answer {
  kind: 'failure' | 'unknown';
  /** The status it is sent with; '' when the code works it out. */
  status: string;
  /** A position in `shapes.refs`. */
  ref: number;
}
export declare const ANSWER_SAYS: Readonly<Record<Answer['kind'], { name: (status: string) => string; note: string }>>;
export declare const answersOf: (model: GraphModel, node: number) => Answer[];

export interface TypeBounds {
  /** Levels opened below the row asked about. */
  depth: number;
  /** Rows the openings may draw in all. */
  rows: number;
}
export declare const TYPE_BOUNDS: Readonly<TypeBounds>;
export declare const insideOf: (at: string) => Set<number>;
export declare const openAll: (
  model: GraphModel,
  roots: Array<{ at: string; ref: number; only?: number }>,
  open?: ReadonlySet<string>,
  bounds?: TypeBounds,
) => { keys: string[]; left: number };
export declare const typeScriptOf: (
  model: GraphModel,
  node: number,
  bounds?: TypeBounds,
) => { text: string; left: number } | null;

export interface CardBounds {
  /** Lines of a face. */
  lines: number;
  /** Types peeked at. */
  types: number;
  /** Rows of each peek. */
  rows: number;
  /** Characters a type is cut to. */
  chars: number;
  /** Rows a card holds however much of it is asked for. */
  most: number;
}
/** What of a card's cut was asked for after all. */
export interface CardWide {
  lines: boolean;
  types: boolean;
  /** Types whose every row is shown. */
  rows: readonly number[];
}
export interface Peek {
  /** The type's position in the registry. */
  type: number;
  name: string;
  kind: string;
  from: string;
  rows: Array<{ name: string; text: string }>;
  /** Rows past the bounds. */
  more: number;
  /** Why there are no rows, or ''. */
  note: string;
}
export interface Card {
  face: Face['face'];
  lines: string[];
  /** Lines past the bounds. */
  more: number;
  peeks: Peek[];
  /** Types past the bounds. */
  left: number;
  /** The ceiling, not the glance, is what still leaves something out. */
  capped: boolean;
}
export declare const CARD_BOUNDS: Readonly<CardBounds>;
export declare const GLANCE: Readonly<CardWide>;
export declare const peekOf: (model: GraphModel, type: number, bounds?: CardBounds) => Peek | null;
export declare const cardOf: (model: GraphModel, node: number, bounds?: CardBounds, wide?: CardWide) => Card | null;
export declare const panelKeysOf: (model: GraphModel, node: number, types: readonly number[]) => string[];
export declare const createHistory: (limit?: number) => History;

export interface Badge {
  kind: 'rows' | 'line';
  count: number;
  title: string;
}

export interface Problems {
  of(node: number): { on: number[]; atLine: number[] };
  count(node: number): number;
  has(node: number): boolean;
  badgesFor(node: number): Badge[];
  reasonsOf(rows: number[]): string[];
  list(): {
    waysIn: Array<{ node: number; rows: number; unhandled: boolean }>;
    crossings: Array<{ edge: number; rows: number }>;
    calls: Array<{ node: number; rows: number; unjoined: boolean }>;
  };
  total: number;
}

export interface PathAnswer extends Neighbourhood {
  /** A path is nodes: an answer never groups. */
  nodes: number[];
  from: number;
  to: number;
  directed: boolean;
  depth: number;
  found: boolean;
  length: number | null;
  paths: number;
  searched: number;
  expandable: false;
}

export interface Upstream {
  target: number;
  depth: number;
  dist: Map<number, number>;
  reached: number;
  doors: number[];
  entries: number[];
  services: number[];
  withoutEntry: number[];
}

/** Plumbing on a question's drawing: folded into chips unless drawn, and unfolded where asked. */
export interface QuestionFold {
  draw?: boolean;
  unfolded?: Set<number>;
  filter?: GraphFilter;
}

export declare const UPSTREAM: readonly string[];
export declare const CROSSING: readonly string[];
export declare const IMPACT_DEPTH: number;
export declare const PATH_DEPTHS: readonly number[];
export declare const EDITOR_NAMES: readonly string[];
export declare const createProblems: (model: GraphModel) => Problems;
export declare const onlyProblems: (
  model: GraphModel,
  hood: Neighbourhood,
  keep: (node: number) => boolean,
) => Neighbourhood & { clean: number };
export declare const shortestPath: (
  model: GraphModel,
  options: {
    from: number;
    to: number;
    directed?: boolean;
    depth?: number;
    cap?: number;
    filter?: GraphFilter;
    fold?: QuestionFold;
  },
) => PathAnswer;
export declare const upstream: (model: GraphModel, target: number, options?: { depth?: number }) => Upstream;
export declare const impactView: (
  model: GraphModel,
  found: Upstream,
  options?: { cap?: number; expanded?: number[]; fold?: QuestionFold },
) => Neighbourhood;
export declare const editorUrl: (editor: string, root: string | null, file: string, line: number) => string | null;
