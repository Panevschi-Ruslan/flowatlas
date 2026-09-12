import type { GraphEdge } from './edges.js';
import type { GraphNode } from './nodes.js';
import type { TypeRegistry } from './types.js';

/**
 * How a row is meant to be read.
 *
 * `action` names something a person can change: a setting to add, an annotation
 * to write, a registration that is missing, a route that is not there. `info` is
 * the tool describing its own limits — an assignment in a template has no method
 * behind it, a receiver typed as a union has no single class — and no edit to the
 * repository will remove it.
 *
 * The distinction exists because a list is only read while most of it is worth
 * reading. Informational rows are folded to one per reason carrying how many
 * places they stand for: the four hundredth of them tells a reader nothing the
 * first did not.
 */
export type UnresolvedLevel = 'action' | 'info';

/**
 * Something the extractor saw but could not resolve.
 *
 * Never dropped silently: precision beats recall, so anything that cannot be
 * turned into a trustworthy edge is recorded here with a location and a reason,
 * and preferably a hint telling the reader how to fix it.
 */
export interface Unresolved {
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  /** Stable kebab-case cause, e.g. `dynamic-channel-name`. */
  reason: string;
  /** How to read this row. Absent means `action`. */
  level?: UnresolvedLevel;
  /**
   * How many places this row stands for. Absent means one.
   *
   * Only an informational row ever stands for more than its own site; the file
   * and line on it are the first of them, so the row still points somewhere real.
   */
  sites?: number;
  /** One sentence a reader can act on. Defaults to the reason when absent. */
  message?: string;
  /** What the reader should do about it. */
  hint?: string;
  /** Id or source text of the symbol involved. */
  symbol?: string;
  /** Name of the adapter that gave up, when one was involved. */
  adapter?: string;
  /** Service this came from, set when repository graphs are merged. */
  service?: string;
  meta?: Record<string, unknown>;
}

/** The graph of a single repository, as written to `<output>/graph.json`. */
export interface RepoGraph {
  schemaVersion: number;
  repo: string;
  /** ISO-8601. Stripped before fixture comparison. */
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  types: TypeRegistry;
  unresolved: Unresolved[];
  meta?: Record<string, unknown>;
}

/** One repository, as it was treated during a build. */
export interface ServiceSummary {
  name: string;
  /** Path as written in the configuration. */
  repo: string;
  type: string;
  /** Extractor that read it, or null when none applied. */
  extractor: string | null;
  /** Why it was left out, when it was. */
  skipped?: 'no-extractor' | 'extract-failed';
}

/** Repo graphs stitched into one, as written to `<output>/project-graph.json`. */
export interface ProjectGraph {
  schemaVersion: number;
  /** ISO-8601. Stripped before fixture comparison. */
  builtAt: string;
  /** Every service the configuration named, whether or not it was read. */
  services: ServiceSummary[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  types: TypeRegistry;
  unresolved: Unresolved[];
  meta?: Record<string, unknown>;
}

/**
 * How much of a node to render. A read-time concern only: what is written to
 * disk is always the complete graph.
 *
 * L0 id, type, label · L1 + location, confidence, type ids · L2 + expanded type
 * structures and wrapping · L3 + source code.
 */
export type DetailLevel = 0 | 1 | 2 | 3;

export const DETAIL_LEVELS: readonly DetailLevel[] = [0, 1, 2, 3];

export const DEFAULT_DETAIL: DetailLevel = 1;

export const DEFAULT_MAX_NODES = 150;
