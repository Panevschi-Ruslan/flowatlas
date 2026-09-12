/**
 * What two graphs of one project differ by, and who would notice.
 *
 * A graph on its own describes; a diff of two of them is what turns a pull
 * request into a verdict. The words here are deliberately about the graph
 * rather than about the source: a node moved, an edge appeared, a declaration
 * changed shape. Nothing in this file knows about git, files or rendering.
 */
import type { Confidence, TypeEntry } from '@flowatlas/core';

/** Version of `diff.json`, independent of the graph schema. */
export const DIFF_FORMAT_VERSION = 1;

/** `from|type|to`, the identity of an edge. The same key P10 keys findings on. */
export const edgeKeyOf = (edge: { from: string; type: string; to: string }): string =>
  `${edge.from}|${edge.type}|${edge.to}`;

/** One node that is in both graphs and reads differently in them. */
export interface NodeChange {
  id: string;
  /** Which repository it belongs to, so a report need not look it up. */
  service: string;
  label: string;
  /** What differs: top-level fields, and `meta.<key>` for each meta key. */
  fields: string[];
}

/**
 * Nodes added, removed, changed and moved.
 *
 * `moved` is its own bucket rather than a kind of change: an id already carries
 * the file and the symbol, so a node whose only delta is the line it sits on
 * says a line was inserted above it and nothing else. Five imports at the top of
 * a controller would otherwise be reported as every method in it changing.
 */
export interface NodeDiff {
  added: string[];
  removed: string[];
  changed: NodeChange[];
  moved: string[];
}

export interface EdgeRef {
  from: string;
  to: string;
  type: string;
}

export interface EdgeChange {
  key: string;
  from: string;
  to: string;
  type: string;
  fields: string[];
}

export interface EdgeDiff {
  added: EdgeRef[];
  removed: EdgeRef[];
  changed: EdgeChange[];
}

/**
 * How one field of a declaration changed between the two revisions.
 *
 * `added` the head declares a field the base did not send · `removed` the base
 * sent one the head no longer declares · `type` both know it and disagree about
 * what is in it · `optionality` one of them may now leave it out.
 */
export const TYPE_FIELD_CHANGES = ['added', 'removed', 'type', 'optionality'] as const;

export type TypeFieldChangeKind = (typeof TYPE_FIELD_CHANGES)[number];

export interface TypeFieldChange {
  /** Dotted path from the top of the type; `items[].price`. */
  field: string;
  change: TypeFieldChangeKind;
  /** Whether the head declares it as one it may be given without. */
  optional: boolean;
  /** What the base declared, or null when it declared nothing. */
  base: string | null;
  /** What the head declares, or null when it declares nothing. */
  head: string | null;
  /** Wire rule that decided or softened this, when one did. */
  rule: string | null;
  message: string;
}

export interface TypeChange {
  id: string;
  name: string;
  baseHash: string;
  headHash: string;
  /**
   * Field-level differences, when a comparator was given.
   *
   * Empty with the hashes differing means one of two things and says so in the
   * report: the shape differs only below the top level — the nested type has a
   * row of its own — or it differs only in ways JSON drops on the way through.
   */
  fieldDiff: TypeFieldChange[];
}

export interface TypeDiff {
  added: string[];
  removed: string[];
  changed: TypeChange[];
}

/** How many rows and how many places, since R07 folded one into the other. */
export interface UnresolvedCount {
  rows: number;
  sites: number;
}

export interface GraphCounts {
  nodes: number;
  edges: number;
  types: number;
  unresolved: UnresolvedCount;
}

export interface GraphDiff {
  nodes: NodeDiff;
  edges: EdgeDiff;
  types: TypeDiff;
  /** How big each side is, so a report can say what the deltas are a share of. */
  counts: { base: GraphCounts; head: GraphCounts };
}

export interface DiffOptions {
  /** How far into nested shapes the field diff walks. Default 3, as P10's. */
  depth?: number;
  /** Wire rules to switch off, by id. */
  disableRules?: readonly string[];
  /**
   * Replace the field-level comparison entirely.
   *
   * The default is `@flowatlas/contracts`' comparator, so `diff` and `contracts`
   * apply the same wire rules and never disagree about whether a field moved.
   * A caller with rules of its own — or a test wanting the hash and nothing
   * else — passes its own here.
   */
  compareTypes?: (base: TypeEntry, head: TypeEntry, id: string) => TypeFieldChange[];
}

/** One way in that reaches a changed node, and how well it is known to. */
export interface BlastEntry {
  id: string;
  /** Repository the way in belongs to. */
  service: string;
  /** `http`, `bot_callback`, `event`, … for an entry; `ui_action` for a button. */
  kind: string;
  /** `entry` or `ui_action`. */
  type: string;
  label: string;
  file: string | null;
  line: number | null;
  /** Hops from the changed node back to here, along the shortest path found. */
  depth: number;
  /**
   * The weakest edge on the strongest path from here to the changed node.
   *
   * A chain is only as trustworthy as its least trustworthy hop, and an entry
   * two paths lead from is as trustworthy as the better of them.
   */
  confidence: Confidence;
}

/** One changed node, and everything that reaches it. */
export interface BlastRow {
  node: string;
  service: string;
  label: string;
  /** Which graph the walk was done on: `head`, or `base` for a removed node. */
  side: 'head' | 'base';
  entries: BlastEntry[];
  /** `<service>:<kind>` → how many, over the whole radius rather than the cut list. */
  counts: Record<string, number>;
  /** Ways in beyond `maxEntries`, counted but not listed (I9). */
  truncated: number;
  /** Every service the walk touched, the node's own included. */
  services: string[];
  /** Services the chain runs into and stops in without reaching a way in. */
  servicesWithoutEntry: string[];
  /** How many nodes reach it at all, so "no entry points" is not "nothing". */
  reached: number;
  /**
   * The walk stopped at its own bound rather than at the end.
   *
   * The counts are then a floor rather than a total, and the report says so:
   * an exact-looking number that is not exact is worse than no number.
   */
  partial: boolean;
}

export interface BlastRadius {
  rows: BlastRow[];
  maxEntries: number;
}

export interface BlastOptions {
  /** Most ways in to list per row. Counts stay exact regardless. Default 150. */
  maxEntries?: number;
  /** How many hops back to walk. Default 25: a browser is a long way from a table. */
  maxDepth?: number;
  /** Most nodes one walk may look at before it gives up being exact. Default 5000. */
  maxWalk?: number;
}
