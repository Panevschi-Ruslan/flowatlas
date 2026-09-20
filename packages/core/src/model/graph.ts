import type { GraphEdge } from './edges.js';
import type { GraphNode } from './nodes.js';
import type { TypeRegistry } from './types.js';

/**
 * How a row is meant to be read, and what it says about the graph.
 *
 * `action` names something a person can change: a setting to add, an annotation
 * to write, a registration that is missing, a route that is not there. An edge
 * is missing and closing the row would draw it.
 *
 * `info` is the tool describing its own limits — a receiver typed as a union has
 * no single class, a generic is never instantiated where it is read. An edge is
 * there and was not drawn, and no edit anyone would want to make to the
 * repository will change that.
 *
 * `nothing` is neither. An assignment in a template has no method behind it and
 * never did; there is no edge, the code is right, and the graph is complete
 * over that place. These rows exist so that a reader who goes looking finds the
 * place and the sentence, and they are counted apart from the two levels above,
 * because adding them to a total makes the total say something untrue.
 *
 * The distinction exists because a list is only read while most of it is worth
 * reading. Rows below `action` are folded to one per reason carrying how many
 * places they stand for: the four hundredth of them tells a reader nothing the
 * first did not.
 */
export type UnresolvedLevel = 'action' | 'info' | 'nothing';

/**
 * Whether a row says something was not read.
 *
 * Every figure the tool prints about its own reading asks this one question, so
 * it is asked in one place: a row at `nothing` stands for a place where no edge
 * exists to draw, and counting it beside a receiver whose class could not be
 * resolved would make both numbers say less than either does alone. A fourth
 * level, if there is ever one, changes this file and nothing else.
 */
export const wasMissed = (row: { level?: UnresolvedLevel }): boolean => row.level !== 'nothing';

/** A list of rows, and the places those rows stand for. */
export interface PlaceCount {
  rows: number;
  sites: number;
}

/** How many places a list of rows stands for, folding included. */
export const sitesIn = (rows: readonly { sites?: number }[]): number =>
  rows.reduce((sum, row) => sum + (row.sites ?? 1), 0);

/**
 * Rows and places in one shape, because every figure about reading needs both.
 *
 * Rows are how long the list is; places are what it covers. They differ
 * wherever a reason was folded, and a report that gave only one of them would
 * be answering a question nobody asked.
 */
export const tally = (rows: readonly { sites?: number }[]): PlaceCount => ({
  rows: rows.length,
  sites: sitesIn(rows),
});

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
