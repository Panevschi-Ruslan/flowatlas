import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cutWindow,
  describeObservedProblem,
  joinIdOf,
  joinOfId,
  mergeObserved,
  OBSERVED_FILE,
  OBSERVED_FORMAT_VERSION,
  observedFromParts,
    observedPathFor,
  parseDuration,
  readObserved,
  type ObservedBucket,
  type ObservedSample,
} from './observed.js';
import { addSpan, emptyAgg } from './observed-stats.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-observed-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let written = 0;
const file = (text: string): string => {
  written += 1;
  const path = join(scratch, `observed-${written}.json`);
  writeFileSync(path, text);
  return path;
};

const older = {
  spans: 3,
  joins: { [joinIdOf('a', 'http_calls', 'b')]: { count: 1, lastSeen: '2026-01-01T00:00:00.000Z' } },
  entries: { b: { hits: 1, lastSeen: null } },
  symbols: {},
  channels: {},
  unmatched: [{ service: 'shop', kind: 'http' as const, name: 'GET /health', count: 1 }],
  ambiguous: [{ kind: 'symbol' as const, name: 'CartService.add', candidates: ['x', 'y'], count: 2 }],
};

describe('the observed file contract', () => {
  it('names a join one way', () => {
    expect(joinIdOf('http_out:shop#a.ts:1:1', 'http_calls', 'entry:catalog:http:GET:/x')).toBe(
      'http_out:shop#a.ts:1:1 -http_calls-> entry:catalog:http:GET:/x',
    );
  });

  it('sits beside the database', () => {
    expect(observedPathFor(join('out', 'graph.db'))).toBe(join('out', OBSERVED_FILE));
  });

  it('names a join one way and reads it back', () => {
    expect(joinOfId(joinIdOf('a:x', 'emits', 'channel:b'))).toEqual({ from: 'a:x', type: 'emits', to: 'channel:b' });
    expect(joinOfId('not a join')).toBeUndefined();
  });

  it('reads version 3 as written', () => {
    const observed = observedFromParts({ buckets: [bucket('2026-01-01T00:00:00.000Z', 3)], samples: {}, sources: [], droppedAttributes: 2, samplesKept: true });
    expect(observed.observedFormatVersion).toBe(OBSERVED_FORMAT_VERSION);
    expect(readObserved(file(JSON.stringify(observed)))).toEqual({ observed });
  });

  it('reads version 2 as one hour of counts with no timings, its version kept', () => {
    const read = readObserved(file(JSON.stringify({ observedFormatVersion: 2, ...older })));
    expect(read.problem).toBeUndefined();
    expect(read.observed).toMatchObject({
      observedFormatVersion: 2,
      spans: 3,
      window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z' },
      joins: { [joinIdOf('a', 'http_calls', 'b')]: { count: 1, lastSeen: '2026-01-01T00:00:00.000Z' } },
      samples: {},
    });
    // Nothing about outcome or time is claimed for carried counts (I3).
    expect(read.observed!.joins[joinIdOf('a', 'http_calls', 'b')]).not.toHaveProperty('errorRate');
    expect(read.observed!.joins[joinIdOf('a', 'http_calls', 'b')]).not.toHaveProperty('p95');
  });

  it('reads version 1 the same way, with nothing ambiguous', () => {
    const { ambiguous: _, ...first } = older;
    const read = readObserved(file(JSON.stringify({ observedFormatVersion: 1, ...first })));
    expect(read.problem).toBeUndefined();
    expect(read.observed).toMatchObject({ observedFormatVersion: 1, ambiguous: [], spans: 3 });
  });

  it('says why a file cannot be read', () => {
    const kindOf = (path: string) => readObserved(path).problem?.kind;
    expect(kindOf(join(scratch, 'none.json'))).toBe('missing');
    expect(kindOf(file('{ "observedFormatVersion": 2, '))).toBe('unparseable');
    expect(kindOf(file('[]'))).toBe('invalid');
    expect(kindOf(file(JSON.stringify({ ...older, observedFormatVersion: 9 })))).toBe('newer-version');
    expect(kindOf(file(JSON.stringify({ ...older, observedFormatVersion: 0 })))).toBe('unknown-version');
    expect(kindOf(file(JSON.stringify(older)))).toBe('unknown-version');
    expect(kindOf(file(JSON.stringify({ ...older, observedFormatVersion: 3 })))).toBe('invalid');
    const invalid = readObserved(file(JSON.stringify({ ...older, observedFormatVersion: 2, joins: { x: { count: 'many' } } })));
    expect(invalid.problem).toMatchObject({ kind: 'invalid', detail: expect.stringContaining('joins.x.count') });
    expect(invalid.observed).toBeUndefined();
    expect(describeObservedProblem(invalid.problem!)).toContain('so nothing seen at run time is shown');
  });
});

const bucket = (hour: string, durationMs: number): ObservedBucket => ({
  hour,
  spans: 1,
  joins: {},
  entries: { e: addSpan(emptyAgg(), { at: hour, durationMs, status: 200 }) },
  symbols: {},
  channels: {},
  unmatched: [],
  ambiguous: [],
});
const sample = (traceId: string, at: string, ms: number): ObservedSample => ({
  traceId,
  at,
  ms,
  spans: 1,
  tree: { id: 'e', label: 'GET /x', kind: 'server', ms },
});
const runOf = (hour: string, ms: number, traceId: string) =>
  observedFromParts({
    buckets: [bucket(hour, ms)],
    samples: { e: { slow: [sample(traceId, hour, ms)], failing: [] } },
    sources: [{ sha256: traceId, format: 'otlp', spans: 1, readAt: hour }],
    droppedAttributes: 1,
    samplesKept: true,
  });

describe('the window', () => {
  const now = new Date('2026-01-02T00:30:00.000Z');

  it('reads a duration in whole hours, days or weeks, and nothing finer', () => {
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(parseDuration('1w')).toBe(7 * 86_400_000);
    for (const no of ['30m', '0h', '1.5h', 'h', '']) expect(parseDuration(no)).toBeUndefined();
  });

  it('adds runs up hour by hour and keeps the slowest samples, once per trace', () => {
    const a = runOf('2026-01-01T00:00:00.000Z', 10, 't1');
    const b = runOf('2026-01-01T00:00:00.000Z', 30, 't2');
    const merged = mergeObserved(mergeObserved(undefined, a, { now }), b, { now });
    expect(merged.buckets).toHaveLength(1);
    expect(merged.entries['e']).toMatchObject({ hits: 2, max: 30 });
    expect(merged.samples['e']!.slow.map((one) => one.traceId)).toEqual(['t2', 't1']);
    expect(mergeObserved(merged, b, { now }).samples['e']!.slow).toHaveLength(2);
    expect(merged.privacy.droppedAttributes).toBe(2);
    expect(merged.sources.map((source) => source.sha256)).toEqual(['t1', 't2']);
  });

  it('drops the hours and samples that ended before since, and remembers since', () => {
    const merged = mergeObserved(
      mergeObserved(undefined, runOf('2026-01-01T10:00:00.000Z', 10, 'old'), { now }),
      runOf('2026-01-01T23:00:00.000Z', 20, 'new'),
      { now, since: '2h' },
    );
    expect(merged.buckets.map((one) => one.hour)).toEqual(['2026-01-01T23:00:00.000Z']);
    expect(merged.samples['e']!.slow.map((one) => one.traceId)).toEqual(['new']);
    expect(merged.window).toEqual({ since: '2h', from: '2026-01-01T23:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });
    expect(cutWindow(merged, undefined, now).buckets).toHaveLength(1);
  });

  it('writes no sample, and says so, when samples are not kept', () => {
    const merged = mergeObserved(undefined, runOf('2026-01-01T00:00:00.000Z', 10, 't1'), { now, samples: false });
    expect(merged.samples).toEqual({});
    expect(merged.privacy.samples.kept).toBe(false);
  });
});
