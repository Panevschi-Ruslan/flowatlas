/**
 * Figures kept per place a span was credited to (P105): how many, how many
 * failed, the statuses answered, and how long they took as a histogram that
 * two runs add up by summing.
 *
 * Pure and small on purpose: the CLI writes these, the page and the MCP server
 * read them, and a window of hours is cut and merged without the traces at
 * hand. Durations are never kept one by one: a list of durations grows with
 * traffic and, per trace, is a fingerprint.
 */

/**
 * Sparse log buckets by index: `bucket = round(log(ms) / log(2^(1/8)))`, each
 * about 9% wide, from `MIN_MS` up. Merged by adding counts.
 */
export type Histogram = Record<string, number>;

/** One bucket's width as a ratio: eight buckets to a doubling. */
export const BUCKET_RATIO = 2 ** (1 / 8);
/** The smallest duration a bucket tells apart; anything shorter shares its bucket. */
export const MIN_MS = 0.01;

const LOG_RATIO = Math.log(BUCKET_RATIO);

/** The bucket a duration falls in. */
export const bucketOf = (ms: number): number => Math.round(Math.log(Math.max(ms, MIN_MS)) / LOG_RATIO);

/** The largest duration bucket `index` holds, to two decimals. */
export const bucketUpper = (index: number): number => round2(BUCKET_RATIO ** (index + 0.5));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** The `q` quantile (0 to 1) of a histogram, as its bucket's upper bound; none for an empty one. */
export const quantile = (histogram: Histogram, q: number): number | undefined => {
  const buckets = Object.entries(histogram)
    .map(([index, count]) => [Number(index), count] as const)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a - b);
  const total = buckets.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return undefined;
  const rank = Math.max(1, Math.ceil(q * total));
  let seen = 0;
  for (const [index, count] of buckets) {
    seen += count;
    if (seen >= rank) return bucketUpper(index);
  }
  return bucketUpper(buckets[buckets.length - 1]![0]);
};

/** What of a span the figures are made of: its start, status, duration and error flag. */
export interface SpanFigures {
  at?: string;
  status?: number;
  durationMs?: number;
  error?: true;
}

/**
 * The figures of one place over one hour or one window.
 *
 * `statuses` counts every HTTP status seen, 4xx included; `errors` counts
 * spans flagged as an error or answering 5xx. `carried` counts spans brought
 * over from a format-1 or format-2 file, whose outcome nobody recorded, so an
 * error rate is taken over the rest only.
 */
export interface Agg {
  count: number;
  errors: number;
  statuses?: Record<string, number>;
  hist?: Histogram;
  max?: number;
  firstSeen: string | null;
  lastSeen: string | null;
  carried?: number;
}

/** The figures as a reader wants them: quantiles instead of buckets. */
export interface Summary {
  count: number;
  p50?: number;
  p95?: number;
  max?: number;
  statuses?: Record<string, number>;
  errors: number;
  /** Errors over the spans whose outcome is known, to four decimals; absent when none is. */
  errorRate?: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

export const emptyAgg = (): Agg => ({ count: 0, errors: 0, firstSeen: null, lastSeen: null });

/** D6: an error is the flag, or a 5xx answer. A 4xx is often the right answer and is in `statuses` only. */
export const isError = (span: SpanFigures): boolean =>
  span.error === true || (span.status !== undefined && span.status >= 500);

const earlier = (a: string | null, b: string | null | undefined): string | null =>
  b === undefined || b === null ? a : a === null || b < a ? b : a;
const later = (a: string | null, b: string | null | undefined): string | null =>
  b === undefined || b === null ? a : a === null || b > a ? b : a;

const addCounts = (into: Record<string, number> | undefined, from: Record<string, number>): Record<string, number> => {
  const sum = { ...into };
  for (const [key, count] of Object.entries(from)) sum[key] = (sum[key] ?? 0) + count;
  return sum;
};

/** Sorted by key, so a file written twice from the same spans is the same bytes. */
const sortedCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0)));

/** Adds one span to `agg`, in place, and returns it. */
export const addSpan = (agg: Agg, span: SpanFigures): Agg => {
  agg.count += 1;
  if (isError(span)) agg.errors += 1;
  if (span.status !== undefined) agg.statuses = sortedCounts(addCounts(agg.statuses, { [String(span.status)]: 1 }));
  if (span.durationMs !== undefined && Number.isFinite(span.durationMs) && span.durationMs >= 0) {
    agg.hist = sortedCounts(addCounts(agg.hist, { [String(bucketOf(span.durationMs))]: 1 }));
    agg.max = agg.max === undefined ? span.durationMs : Math.max(agg.max, span.durationMs);
  }
  agg.firstSeen = earlier(agg.firstSeen, span.at);
  agg.lastSeen = later(agg.lastSeen, span.at);
  return agg;
};

/** `a` and `b` as one: the same as adding both sets of spans to one `Agg`. */
export const mergeAgg = (a: Agg, b: Agg): Agg => {
  const merged: Agg = {
    count: a.count + b.count,
    errors: a.errors + b.errors,
    firstSeen: earlier(a.firstSeen, b.firstSeen),
    lastSeen: later(a.lastSeen, b.lastSeen),
  };
  if (a.statuses !== undefined || b.statuses !== undefined) {
    merged.statuses = sortedCounts(addCounts(a.statuses, b.statuses ?? {}));
  }
  if (a.hist !== undefined || b.hist !== undefined) merged.hist = sortedCounts(addCounts(a.hist, b.hist ?? {}));
  if (a.max !== undefined || b.max !== undefined) merged.max = Math.max(a.max ?? 0, b.max ?? 0);
  const carried = (a.carried ?? 0) + (b.carried ?? 0);
  if (carried > 0) merged.carried = carried;
  return merged;
};

/**
 * The figures a reader shows. A quantile never reads above the exact `max`,
 * and nothing that was not measured is said: no timing without a duration, no
 * error rate when every span was carried over without its outcome (I3).
 */
export const summarise = (agg: Agg): Summary => {
  const summary: Summary = { count: agg.count, errors: agg.errors, firstSeen: agg.firstSeen, lastSeen: agg.lastSeen };
  if (agg.hist !== undefined && agg.max !== undefined) {
    const max = round2(agg.max);
    const p50 = quantile(agg.hist, 0.5);
    const p95 = quantile(agg.hist, 0.95);
    if (p50 !== undefined) summary.p50 = Math.min(p50, max);
    if (p95 !== undefined) summary.p95 = Math.min(p95, max);
    summary.max = max;
  }
  if (agg.statuses !== undefined) summary.statuses = agg.statuses;
  const known = agg.count - (agg.carried ?? 0);
  if (known > 0) summary.errorRate = Math.round((agg.errors / known) * 10000) / 10000;
  return summary;
};
