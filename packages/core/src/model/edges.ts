/**
 * Edge kinds of the graph model. Closed list; adding one is a schema change.
 *
 * Module membership is deliberately not an edge — it is recorded as metadata on
 * the member, so this list stays exactly the one the data model defines.
 */
export const EDGE_TYPES = [
  'imports',
  'injects',
  'calls',
  'handles',
  'guarded_by',
  'queries',
  'caches',
  'emits',
  'consumes',
  'http_calls',
  'hits',
  'triggers',
  'reads_config',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * How much an edge can be trusted.
 *
 * `static`    — proven by the type system; must never be wrong.
 * `marker`    — asserted by an explicit annotation in the source.
 * `declared`  — asserted by a document describing a service nothing here reads.
 * `heuristic` — inferred from naming or shape; may be wrong.
 * `runtime`   — observed at run time rather than derived from source.
 *
 * `marker` and `declared` are both assertions rather than proofs, and they are
 * still two different things. An annotation is written by somebody who can see
 * the code it is attached to, and it lives in a repository this tool reads, so
 * a reader who wants to delete it knows where to go. A document is written by
 * somebody who cannot see your code, about code that is not here at all, and
 * nothing in this repository can be edited to make it true. That is why the
 * document ranks lower, and why the two may not share a word: a reader
 * filtering on `marker` to find annotations should not be handed a service.
 */
export const CONFIDENCE_LEVELS = ['static', 'marker', 'declared', 'heuristic', 'runtime'] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Higher wins when the same edge is contributed twice.
 *
 * The gap between `declared` and `heuristic` is the one that does the work. A
 * document outranks a guess, so a declared route beats a path the extractor had
 * to infer; and it is outranked by everything read from real source, so the day
 * the declared service is configured as a repository its edges are raised to
 * what was actually read, without anybody having to remember to.
 */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  static: 4,
  marker: 3,
  declared: 2,
  heuristic: 1,
  runtime: 0,
};

export const strongerConfidence = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  confidence: Confidence;
  /** Type-registry ids of the call parameters, in declaration order. */
  params?: string[];
  /** Type-registry id of the return value. */
  returns?: string;
  /** Repo-relative POSIX path of the site that produced this edge. */
  file?: string;
  line?: number;
  meta?: Record<string, unknown>;
}
