import { describe, expect, it } from 'vitest';
import { addSpan, BUCKET_RATIO, bucketOf, bucketUpper, emptyAgg, mergeAgg, quantile, summarise, type Agg, type SpanFigures } from './observed-stats.js';

/** A fixed spread of durations, the same every run. */
const durations = Array.from({ length: 500 }, (_, i) => Math.round((0.5 + ((i * 7919) % 997) * 1.7) * 100) / 100);
const exact = (sorted: number[], q: number): number => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
const aggOf = (spans: SpanFigures[]): Agg => spans.reduce((agg, span) => addSpan(agg, span), emptyAgg());

describe('log buckets', () => {
  it('are about 9% wide, eight to a doubling', () => {
    expect(BUCKET_RATIO).toBeCloseTo(1.0905, 4);
    expect(bucketOf(2) - bucketOf(1)).toBe(8);
    expect(bucketOf(0.001)).toBe(bucketOf(0.01));
  });

  it('give quantiles within one bucket of the sorted list', () => {
    const sorted = [...durations].sort((a, b) => a - b);
    const agg = aggOf(durations.map((durationMs) => ({ durationMs })));
    for (const q of [0.5, 0.95, 0.99]) {
      const got = quantile(agg.hist!, q)!;
      const want = exact(sorted, q);
      expect(got).toBeGreaterThanOrEqual(want);
      expect(got / want).toBeLessThanOrEqual(BUCKET_RATIO + 0.001);
    }
    expect(agg.max).toBe(sorted[sorted.length - 1]);
    expect(quantile({}, 0.5)).toBeUndefined();
    expect(bucketUpper(bucketOf(100))).toBeGreaterThanOrEqual(100);
  });
});

describe('figures of a place', () => {
  const spans: SpanFigures[] = durations.map((durationMs, i) => ({
    durationMs,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    ...(i % 10 === 0 ? { status: 500 } : i % 10 === 1 ? { status: 404 } : { status: 200 }),
    ...(i % 25 === 2 ? { error: true as const } : {}),
  }));

  it('merge to what adding both sets of spans to one gives', () => {
    const half = Math.floor(spans.length / 2);
    expect(mergeAgg(aggOf(spans.slice(0, half)), aggOf(spans.slice(half)))).toEqual(aggOf(spans));
    expect(mergeAgg(emptyAgg(), aggOf(spans))).toEqual(aggOf(spans));
  });

  it('count the error flag and a 5xx as errors, and a 4xx only in the status mix', () => {
    const agg = aggOf(spans);
    expect(agg.errors).toBe(50 + 20);
    expect(agg.statuses).toEqual({ '200': 400, '404': 50, '500': 50 });
    expect(summarise(agg)).toMatchObject({ count: 500, errors: 70, errorRate: 0.14, firstSeen: spans[0]!.at, lastSeen: spans[499]!.at });
  });

  it('say no timing for spans without a duration, and never a p95 above the max', () => {
    const untimed = summarise(aggOf([{ status: 200 }, { status: 200 }]));
    expect(untimed).toEqual({ count: 2, errors: 0, errorRate: 0, statuses: { '200': 2 }, firstSeen: null, lastSeen: null });
    const one = summarise(aggOf([{ durationMs: 12 }]));
    expect(one).toMatchObject({ p50: 12, p95: 12, max: 12 });
  });

  it('take an error rate over the spans whose outcome is known only', () => {
    expect(summarise({ ...emptyAgg(), count: 4, carried: 4 })).not.toHaveProperty('errorRate');
    expect(summarise({ ...aggOf([{ status: 500 }]), count: 5, carried: 4 })).toMatchObject({ errorRate: 1 });
  });
});
