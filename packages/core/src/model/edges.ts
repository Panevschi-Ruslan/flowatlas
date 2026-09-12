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
 * `heuristic` — inferred from naming or shape; may be wrong.
 * `runtime`   — observed at run time rather than derived from source.
 */
export const CONFIDENCE_LEVELS = ['static', 'marker', 'heuristic', 'runtime'] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Higher wins when the same edge is contributed twice. */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  static: 3,
  marker: 2,
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
