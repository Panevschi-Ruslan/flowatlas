/**
 * `.flowatlas/diff.json` — the whole answer, as a document.
 *
 * Separate from `GraphDiff` because a diff of two graphs is pure arithmetic and
 * this is a run: which refs, which commits, what came from the cache, how long
 * it took, and what could not be read. A consumer reads this; the arithmetic is
 * only one section of it.
 */
import type { ContractFinding } from '@flowatlas/contracts';
import type { Confidence, PinSource } from '@flowatlas/core';
import type { RuleViolation } from '../rules/types.js';
import type { FlowChange } from './sequence.js';
import type { BlastRow, GraphDiff } from './types.js';

/** One repository, as it was read on one side of the comparison. */
export interface DiffSource {
  /** The commit that was read, or null when the working tree was. */
  sha: string | null;
  /** The ref this side asked for, or null for the working tree. */
  ref: string | null;
  /** True when the graph came from `<output>/cache/<sha>/` rather than a read. */
  cached: boolean;
  /** Where the dependencies the checker resolved against came from. */
  nodeModules: 'linked' | 'present' | 'missing';
}

export interface DiffSide {
  /** The ref as it was written on the command line, or null for the tree. */
  ref: string | null;
  services: Record<string, DiffSource>;
}

/**
 * Something that could not be read, and what it cost.
 *
 * `ref-not-found` and `not-a-git-repo` mean a service used its working tree on
 * both sides and is therefore reported as unchanged, which is a claim worth
 * printing rather than assuming. `node-modules-*` say what the type checker had
 * to resolve against; `dirty-working-tree` says a head ref was named and the
 * uncommitted work was left out on purpose; `impact-truncated` says the diff
 * below is complete and the table of who would notice is not;
 * `flows-truncated` says some ways in were not walked for `flows` (P116).
 */
export const DIFF_WARNINGS = [
  'ref-not-found',
  'not-a-git-repo',
  'node-modules-missing',
  'node-modules-linked',
  'base-extract-failed',
  'dirty-working-tree',
  'impact-truncated',
  'flows-truncated',
] as const;

export type DiffWarningReason = (typeof DIFF_WARNINGS)[number];

export interface DiffWarning {
  reason: DiffWarningReason;
  /** The repository it is about, or null when it is about the run. */
  service: string | null;
  message: string;
  hint: string;
}

/**
 * The contract findings of both sides, split by what this revision did to them.
 *
 * `new` is what the branch introduced and the only thing `--fail-on-contract-break`
 * looks at. `preexisting` is the backlog, printed so it stays visible and never
 * counted against the change in front of the reviewer.
 */
export interface DiffContracts {
  new: ContractFinding[];
  fixed: ContractFinding[];
  preexisting: ContractFinding[];
  ignored: ContractFinding[];
}

/**
 * The architecture rules' violations of both sides, split by what this
 * revision did to them (format 4, P114), keyed on `rule|<name>|<from>|<to>`
 * so a line moving never makes one new. `excused` is the head side's, which
 * is the side that ships, and never counted against the change.
 */
export interface DiffRules {
  new: RuleViolation[];
  fixed: RuleViolation[];
  existing: RuleViolation[];
  excused: RuleViolation[];
}

export interface DiffTiming {
  baseMs: number;
  headMs: number;
  diffMs: number;
  totalMs: number;
}

export interface DiffReport {
  /**
   * The format the document was written in. A document of an older format is
   * read into this shape with the sections it predates empty; `sectionsMissing`
   * says which (P96).
   */
  diffFormatVersion: number;
  schemaVersion: number;
  /** ISO-8601. Stripped before any comparison, like every other artefact's. */
  generatedAt: string;
  base: DiffSide;
  head: DiffSide;
  nodes: GraphDiff['nodes'];
  edges: GraphDiff['edges'];
  types: GraphDiff['types'];
  counts: GraphDiff['counts'];
  /** Gap ids added and removed, gaps and findings (format 2, P96). */
  unresolved: GraphDiff['unresolved'];
  /** Calls and channel ends that stopped joining (format 2, P96). */
  joins: GraphDiff['joins'];
  /** One row per changed or removed node, in the order they should be read. */
  impact: BlastRow[];
  /**
   * The ways in the impact reaches (and those added or removed), each walked
   * on both sides and compared step by step, the most changed first (format
   * 3, P116).
   */
  flows: FlowChange[];
  contracts: DiffContracts;
  /** The rules' violations, new, fixed, already there and excused (format 4, P114). */
  rules: DiffRules;
  warnings: DiffWarning[];
  timing: DiffTiming;
}

/* ── `flowatlas check --env` (P117) ── */

/**
 * Version of `check.<env>.json`, independent of the diff format it carries:
 * a check document holds a whole `diff.json` (deployed side as base,
 * candidate as head) under `diff`, read through `parseGraphDiff` like any.
 */
export const CHECK_FORMAT_VERSION = 1;

/** `deployable` exits 0, `not deployable` 1, `undecided` 2. */
export const CHECK_VERDICTS = ['deployable', 'not deployable', 'undecided'] as const;
export type CheckVerdictWord = (typeof CHECK_VERDICTS)[number];

/** What a reason is about: a contract finding, an architecture rule, a join deploying would lose. */
export const CHECK_REASON_KINDS = ['contract', 'rule', 'join'] as const;
export type CheckReasonKind = (typeof CHECK_REASON_KINDS)[number];

/** Why a check could not decide, by the words the refusal is made of. */
export const CHECK_REFUSALS = ['unknown-environment', 'ref-not-found', 'not-a-git-repo', 'head-not-found'] as const;
export type CheckRefusalReason = (typeof CHECK_REFUSALS)[number];

/** A file and line inside a service's repository. */
export interface CheckPlace {
  service: string;
  file: string;
  line?: number;
}

/**
 * One thing deploying would introduce, or one already running.
 *
 * `code` is the finding kind (`missing_required`), the rule's name, or the
 * lost join's kind; `key` the line-free key the diff already classifies it by
 * (`findingKey`, `rule|…`, `join|<kind>|<caller>|<target>`). `heuristic` is
 * true when the edge it rests on is a guess (I4): it still counts, and says so.
 */
export interface CheckReason {
  kind: CheckReasonKind;
  code: string;
  message: string;
  key: string;
  /** Whose: the sender, the rule's `from` service, the caller's service. */
  service: string | null;
  at?: CheckPlace;
  confidence: Confidence;
  heuristic: boolean;
}

/** One service's ref in the environment, whose word it is, and the commit it named. */
export interface CheckPin {
  service: string;
  ref: string;
  from: PinSource;
  /** The commit the ref resolved to; null when it resolved to none (the run is then undecided). */
  sha: string | null;
  replaced?: { ref: string; from: PinSource };
}

/** A service the candidate side reads somewhere else than its pin. */
export interface CheckMove {
  service: string;
  /** The pin; `ref` null for a service the environment does not run yet. */
  from: { ref: string | null; sha: string | null };
  /** `--head`, or null for the working tree (`dirty` when it has uncommitted work). */
  to: { ref: string | null; sha: string | null; dirty: boolean };
}

/** Why there is no verdict: the environment, or a ref that names nothing to read. */
export interface CheckRefusal {
  reason: CheckRefusalReason;
  service: string | null;
  message: string;
  hint: string;
}

export interface CheckVerdict {
  verdict: CheckVerdictWord;
  /** What deploying introduces: every one of them is why it is not deployable. */
  reasons: CheckReason[];
  /** Problems the deployed side already has: listed, never failing the run (D1). */
  already: CheckReason[];
  /** Why it could not decide; non-empty exactly when `verdict` is `undecided`. */
  undecided: CheckRefusal[];
  /** What the reader should know about how the answer was reached: overrides, nothing to deploy. */
  notes: string[];
}

/** `<output>/check.<env>.json`: one environment's answer, and the comparison it was read from. */
export interface CheckReport {
  checkFormatVersion: number;
  generatedAt: string;
  environment: string;
  /** The pins file read, relative to the configuration; null when every pin came from flags or variables. */
  pinsFile: string | null;
  pins: CheckPin[];
  /** Configured services this environment does not run: on neither side. */
  notDeployed: string[];
  moved: CheckMove[];
  /** `--head`, or null for the working tree. */
  head: string | null;
  verdict: CheckVerdict;
  /** Deployed as base, candidate as head; null when there was nothing to compare. */
  diff: DiffReport | null;
}
