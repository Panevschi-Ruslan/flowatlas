/**
 * What two graphs of one project differ by, and who would notice.
 *
 * A graph on its own describes; a diff of two of them is what turns a pull
 * request into a verdict. The words here are deliberately about the graph
 * rather than about the source: a node moved, an edge appeared, a declaration
 * changed shape. Nothing in this file knows about git, files or rendering.
 */
import type { Confidence, TypeEntry } from '@flowatlas/core';

/**
 * Version of `diff.json`, independent of the graph schema.
 *
 * 2 (P96) added `unresolved` (the gaps and findings each side has that the
 * other does not, by gap id) and `joins` (the calls that stopped joining).
 * 3 (P116) added `flows`: each way in the impact reaches, walked on both
 * sides and compared step by step. 4 (P114) added `rules`: the architecture
 * rules' violations new, fixed, already there and excused. 5 (P118) added
 * `spec`: the API documents' changes by kind, or `null` when `--spec` was not
 * asked for (not computed, which an empty list would not say). Every bump adds its
 * sections to `DIFF_SECTIONS` and a lift in `schema.ts`, so a document an
 * older flowatlas wrote is still read.
 */
export const DIFF_FORMAT_VERSION = 5;

/**
 * The sections of `diff.json` by the format that introduced them.
 *
 * A document of an older format is read with these sections empty; this says
 * which of them it never had, so a reader can say "not computed" rather than
 * "nothing" (I3).
 */
export const DIFF_SECTIONS: Readonly<Record<string, number>> = Object.freeze({
  unresolved: 2,
  joins: 2,
  flows: 3,
  rules: 4,
  spec: 5,
});

/** The sections a document of this format predates, in `DIFF_SECTIONS` order. */
export const sectionsMissing = (report: { diffFormatVersion: number }): string[] =>
  Object.entries(DIFF_SECTIONS)
    .filter(([, since]) => since > report.diffFormatVersion)
    .map(([section]) => section);

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

/** What a row of the unresolved list is about, as a diff tells them apart (P81). */
export const GAP_REF_KINDS = ['gap', 'finding'] as const;
export type GapRefKind = (typeof GAP_REF_KINDS)[number];

/**
 * One gap id on one side: every row of one reason in one file (P96).
 *
 * Gaps (places the reader missed) and findings (something said about the
 * code); notes, and gaps with no edge to draw, are not places to look and are
 * left out. `line` is the first row's, `node` the method that row is in when
 * the graph draws one, and `sites` the places the rows stand for.
 */
export interface GapRef {
  /** `gap:<service>|<file>|<reason>`, what `flowatlas accept` and the tools take. */
  id: string;
  kind: GapRefKind;
  service: string;
  file: string;
  line?: number;
  reason: string;
  node?: string;
  sites: number;
}

/** Gap ids the head has and the base does not (`added`), and the other way round. */
export interface UnresolvedDiff {
  added: GapRef[];
  removed: GapRef[];
}

/**
 * How a join stopped (P96).
 *
 * `target-gone` a request that joined a route on the base side joins nothing
 * on the head side · `no-producer` a channel whose consumers are still there
 * lost the last thing that published it, or (`now` `never-produced`, P117) a
 * consumer the head side added to a channel nothing publishes · `no-consumer`
 * a channel still published lost the last thing that handled it.
 */
export const LOST_JOIN_KINDS = ['target-gone', 'no-producer', 'no-consumer'] as const;
export type LostJoinKind = (typeof LOST_JOIN_KINDS)[number];

/**
 * A join the base side made and the head side does not, from the end that is
 * still there: the request, or the channel's remaining producer or consumer.
 */
export interface LostJoin {
  kind: LostJoinKind;
  /** The node left behind: the request, a consumer, a producer. */
  caller: string;
  /** What it joined on the base side: the route, or the channel. */
  target: string;
  /** The edge the base side joined by: `http_calls`, `hits`, `consumes`, `emits`. */
  edge: string;
  /** Whose the caller is. */
  service: string;
  /** Whose the target was; null for a channel, which is nobody's. */
  targetService: string | null;
  /**
   * What the head side says instead: the reason of the row it wrote on the
   * caller (`target-route-not-found`), `no-edge` when it wrote none, the
   * kind for a channel, or `never-produced` for a consumer the head side added
   * to a channel nothing publishes (P117).
   */
  now: string;
  /** True when the target is gone from the head graph, not only the join. */
  targetRemoved: boolean;
}

export interface JoinDiff {
  lost: LostJoin[];
}

export interface GraphDiff {
  nodes: NodeDiff;
  edges: EdgeDiff;
  types: TypeDiff;
  /** Gap ids added and removed (P96). */
  unresolved: UnresolvedDiff;
  /** The joins the base side made that the head side does not (P96). */
  joins: JoinDiff;
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
