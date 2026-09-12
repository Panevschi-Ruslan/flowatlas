/**
 * `.flowatlas/diff.json` — the whole answer, as a document.
 *
 * Separate from `GraphDiff` because a diff of two graphs is pure arithmetic and
 * this is a run: which refs, which commits, what came from the cache, how long
 * it took, and what could not be read. A consumer reads this; the arithmetic is
 * only one section of it.
 */
import type { ContractFinding } from '@flowatlas/contracts';
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
 * below is complete and the table of who would notice is not.
 */
export const DIFF_WARNINGS = [
  'ref-not-found',
  'not-a-git-repo',
  'node-modules-missing',
  'node-modules-linked',
  'base-extract-failed',
  'dirty-working-tree',
  'impact-truncated',
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

export interface DiffTiming {
  baseMs: number;
  headMs: number;
  diffMs: number;
  totalMs: number;
}

export interface DiffReport {
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
  /** One row per changed or removed node, in the order they should be read. */
  impact: BlastRow[];
  contracts: DiffContracts;
  warnings: DiffWarning[];
  timing: DiffTiming;
}
