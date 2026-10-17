/**
 * What checking the architecture rules says (P114): `rules.json`, the
 * `rules` section of `doctor`, the `rules` section of `diff.json` and what
 * the MCP server's `check_rules` answers are all made of these.
 *
 * Nothing here is a node or an edge: a rule is read over the graph that was
 * built (I11), and its answer is a document of its own with its own version.
 */
import type { Confidence, GraphEdge, GraphNode, RuleSeverity, RuleShape } from '@flowatlas/core';

/** Version of `rules.json`; bump when a field is removed or changes meaning. */
export const RULES_FORMAT_VERSION = 1;

/** The file `flowatlas rules` writes beside the database, whatever it printed. */
export const RULES_FILE = 'rules.json';

/** How a rule came out: nothing broke it, something did, or it could not be checked. */
export const RULE_STATUSES = ['held', 'broken', 'unchecked'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** Why a rule could not be checked, or what is worth knowing beside its answer. */
export const RULE_REASONS = ['rule-matches-nothing', 'rule-over-partial-read'] as const;

/** One hop of a violation's path, as the graph holds it. */
export interface RuleHop {
  from: string;
  to: string;
  type: string;
  confidence: Confidence;
}

/** Where a fix goes: the node on the near side of the hop that crossed. */
export interface RulePlace {
  service: string;
  file: string;
  line?: number;
}

/** One way the graph breaks one rule. */
export interface RuleViolation {
  rule: string;
  shape: RuleShape;
  severity: RuleSeverity;
  /** Why the rule exists, as the configuration says it. */
  note?: string;
  /** `rule|<name>|<from>|<to>`, each end by `stableNodeKey`: no line, so a reformat never makes it new (D5). */
  key: string;
  /** Where the offending path starts: the call, request, publisher, consumer or query. */
  from: string;
  /** What it reaches that the rule is about: the route, table, channel or node. */
  to: string;
  fromService: string;
  /** The service `to` belongs to; null for a channel, which belongs to none (I6). */
  toService: string | null;
  /** The kind of the hop that crossed: `hits`, `http_calls`, `consumes`, … */
  via: string;
  /** Every hop from `from` to `to`, in order; empty when a path that must exist is missing. */
  path: RuleHop[];
  /** The crossing hop's place, where the fix goes. */
  at?: RulePlace;
  /** The weakest confidence on the path (I4). */
  confidence: Confidence;
  /** True when that is a guess: shown at the rule's severity, failing only with `failOnHeuristic` (D4). */
  heuristic: boolean;
  message: string;
  /** Services the rule names that the build read in part (`rule-over-partial-read`). */
  partial?: string[];
  /** On an excused violation: the note of the `accept rule:<name>` entry that excused it. */
  excusedBy?: string;
}

/** A rule that could not be checked, never a pass (I3). */
export interface RuleUnchecked {
  rule: string;
  shape: RuleShape;
  severity: RuleSeverity;
  /** `rule|<name>|unchecked|<side>`, so a baseline can hold it like a violation. */
  key: string;
  reason: 'rule-matches-nothing';
  /** Which part of the rule names nothing: `from`, `to`, `source` or `mayReach`. */
  side: string;
  /** The part as it was written, `service biling`. */
  selector: string;
  message: string;
}

/** Something true of a rule's answer that is not a violation. */
export interface RuleNote {
  rule: string;
  reason: 'rule-over-partial-read';
  service: string;
  message: string;
}

/** One configured rule and how it came out. */
export interface RuleResult {
  name: string;
  shape: RuleShape;
  severity: RuleSeverity;
  note?: string;
  status: RuleStatus;
  /** How many nodes each side of the rule selects, by side (`--list`). */
  matched: Record<string, number>;
  /** Violations counted, and those an accept excused. */
  violations: number;
  excused: number;
  /** Set when a transitive walk stopped at its bound: the rule held as far as it looked. */
  walkCut?: true;
}

export interface RulesSummary {
  rules: number;
  held: number;
  broken: number;
  unchecked: number;
  errors: number;
  warnings: number;
  infos: number;
  /** Violations along a guessed edge, at any severity. */
  heuristic: number;
  excused: number;
}

export interface RulesReport {
  rulesFormatVersion: number;
  rules: RuleResult[];
  /** Ordered by severity, then rule, then place; excused ones are in `excused`. */
  violations: RuleViolation[];
  excused: RuleViolation[];
  unchecked: RuleUnchecked[];
  notes: RuleNote[];
  summary: RulesSummary;
}

/** As much of a graph as a rule reads: the joined nodes and edges, each service's tags, and what was read in part. */
export interface RuleGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Tags by service name, from `services[].tags`. */
  tags: Readonly<Record<string, readonly string[]>>;
  /** Services the build read in part (P75): skipped, or with packages not installed. */
  partial?: readonly string[];
}
