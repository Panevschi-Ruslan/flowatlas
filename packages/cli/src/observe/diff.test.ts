import { describe, expect, it } from 'vitest';
import { changeSay, diffLines, diffObserved, DIFF_MIN_COUNT, type ObservedDiffInput } from './diff.js';

/** Two weeks of a small shop, before and after a deploy (P111). */
const WINDOW_A = { from: '2026-10-03T00:00:00.000Z', to: '2026-10-10T00:00:00.000Z' };
const WINDOW_B = { from: '2026-10-10T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' };

const before: ObservedDiffInput = {
  window: WINDOW_A,
  entries: {
    'entry:shop:http:GET:/orders': { hits: 400, p95: 80, errorRate: 0, statuses: { '200': 400 } },
    'entry:shop:http:POST:/orders': { hits: 120, p95: 150, errorRate: 0.01, statuses: { '201': 119, '500': 1 } },
    'entry:shop:http:GET:/rare': { hits: 3, p95: 10, errorRate: 0, statuses: { '200': 3 } },
    'entry:shop:http:GET:/legacy': { hits: 50, p95: 20, errorRate: 0, statuses: { '200': 50 } },
    'entry:shop:http:GET:/steady': { hits: 90, p95: 30, errorRate: 0, statuses: { '200': 90 } },
  },
  joins: {
    'http_out:shop#a.ts:1:1 -http_calls-> entry:catalog:http:GET:/items': { count: 400, p95: 60, errorRate: 0, statuses: { '200': 400 } },
  },
};

const after: ObservedDiffInput = {
  window: WINDOW_B,
  entries: {
    'entry:shop:http:GET:/orders': { hits: 410, p95: 160, errorRate: 0, statuses: { '200': 410 } },
    'entry:shop:http:POST:/orders': { hits: 130, p95: 155, errorRate: 0.08, statuses: { '201': 119, '500': 6, '503': 5 } },
    'entry:shop:http:GET:/rare': { hits: 2, p95: 90, errorRate: 0.5, statuses: { '200': 1, '500': 1 } },
    'entry:shop:http:GET:/new': { hits: 25, p95: 12, errorRate: 0, statuses: { '200': 25 } },
    'entry:shop:http:GET:/steady': { hits: 95, p95: 31, errorRate: 0, statuses: { '200': 95 } },
  },
  joins: {
    'http_out:shop#a.ts:1:1 -http_calls-> entry:catalog:http:GET:/items': { count: 410, p95: 150, errorRate: 0, statuses: { '200': 410 } },
  },
};

describe('two observed files compared', () => {
  const diff = diffObserved(before, after);

  it('lists what got slower, the largest p95 rise first', () => {
    expect(diff.slower.map((row) => row.id)).toEqual([
      'http_out:shop#a.ts:1:1 -http_calls-> entry:catalog:http:GET:/items',
      'entry:shop:http:GET:/orders',
    ]);
    expect(diff.slower[1]).toMatchObject({ kind: 'entry', count: [400, 410], p95: [80, 160] });
    // A millisecond on 30 is not slower.
    expect(diff.slower.some((row) => row.id.endsWith('/steady'))).toBe(false);
  });

  it('lists what fails more, with the 5xx statuses it never answered before', () => {
    expect(diff.failing.map((row) => row.id)).toEqual(['entry:shop:http:POST:/orders']);
    expect(diff.failing[0]!.newStatuses).toEqual(['503']);
    expect(changeSay(diff.failing[0]!, 'errors')).toBe('errors 1% → 8%, new 503');
  });

  it('lists what appeared and what went quiet, with no floor', () => {
    expect(diff.appeared.map((row) => row.id)).toEqual(['entry:shop:http:GET:/new']);
    expect(diff.gone.map((row) => row.id)).toEqual(['entry:shop:http:GET:/legacy']);
    expect(diff.gone[0]).toMatchObject({ gone: true, new: false, count: [50, 0] });
  });

  it('compares a time or a failure share only above the floor in both files (D3)', () => {
    expect(DIFF_MIN_COUNT).toBe(20);
    expect([...diff.slower, ...diff.failing].some((row) => row.id.endsWith('/rare'))).toBe(false);
    expect(diff.tooFew).toBe(1);
    const low = diffObserved(before, after, { minCount: 2 });
    expect(low.slower.map((row) => row.id)).toContain('entry:shop:http:GET:/rare');
    expect(low.tooFew).toBe(0);
  });

  it('keeps only the ids it is told to, as the page does with the ones its graph holds', () => {
    const kept = diffObserved(before, after, { keep: (kind) => kind === 'entry' });
    expect(kept.slower.map((row) => row.kind)).toEqual(['entry']);
  });

  it('compares counts only with a file that measured no times, and says so', () => {
    const older: ObservedDiffInput = {
      window: WINDOW_A,
      entries: { 'entry:shop:http:GET:/orders': { hits: 400 } },
      joins: {},
    };
    const counted = diffObserved(older, after);
    expect(counted.timed).toEqual([false, true]);
    expect(counted.slower).toEqual([]);
    expect(counted.appeared.map((r) => r.id)).toContain('entry:shop:http:POST:/orders');
    // An older file recorded no statuses: nothing is "new" against it.
    expect(counted.failing).toEqual([]);
    expect(changeSay({ kind: 'entry', id: 'x', count: [400, 410], p95: [undefined, 160], errorRate: [undefined, 0],
      newStatuses: [], gone: false, new: false }, 'time')).toBe('p95 not in a → 160 ms');
    expect(diffLines(counted, ['last.json', 'this.json'])[1]).toBe('  last.json measured no times (an older file): only counts are compared');
  });

  it('says it all as text, both windows first', () => {
    const lines = diffLines(diff, ['last-week.json', 'this-week.json']);
    expect(lines[0]).toBe('Run time changes: last-week.json (2026-10-03 00:00 to 2026-10-10 00:00 UTC) → this-week.json (2026-10-10 00:00 to 2026-10-17 00:00 UTC)');
    expect(lines).toContain('  way in  entry:shop:http:GET:/orders  p95 80 ms → 160 ms (+100%) · 400 → 410 requests');
    expect(lines).toContain('No longer seen in this-week.json · 1');
    expect(lines[lines.length - 1]).toBe('1 seen on both sides had fewer than 20 requests on one: not compared (--min-count)');
  });
});
