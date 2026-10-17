import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { observedPathFor, readObserved, type GraphEdge, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { runObserve, type ObserveOptions } from '../commands/observe.js';
import { PLANTED } from './__fixtures__/planted.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const report = JSON.parse(readFileSync(join(fixture, 'expected.link-report.json'), 'utf8')) as LinkReport;
const checkout = join(fixture, 'traces/checkout.otlp.json');
const billing = join(fixture, 'traces/billing.observe.json');
const series = join(fixture, 'traces/billing.batches.observe.json');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-store-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** A graph of its own, so each case starts with no observed file. */
const built = writeGraphDbOnce();
let made = 0;
const freshDb = (): string => {
  made += 1;
  const dir = mkdtempSync(join(scratch, `case-${made}-`));
  copyFileSync(built, join(dir, 'graph.db'));
  return join(dir, 'graph.db');
};

function writeGraphDbOnce(): string {
  const path = join(scratch, 'graph.db');
  writeGraphDb(graph, report, path);
  return path;
}

const NOW = new Date('2025-10-16T09:30:00.000Z');
const observe = (db: string, files: string[], options: Partial<ObserveOptions> = {}) =>
  runObserve(files, { db, now: NOW, print: () => {}, ...options });
const fileOf = (db: string): string => readFileSync(observedPathFor(db), 'utf8');

describe('runs that add up', () => {
  it('gives the same file from two runs over two files as from one run over both', () => {
    const once = freshDb();
    observe(once, [checkout, billing, series]);
    const twice = freshDb();
    observe(twice, [checkout]);
    observe(twice, [billing, series]);
    expect(JSON.parse(fileOf(twice))).toEqual(JSON.parse(fileOf(once)));
  });

  it('skips a file it has read before, and says so', () => {
    const db = freshDb();
    const first = observe(db, [checkout]);
    const printed: string[] = [];
    const again = observe(db, [checkout], { print: (line) => printed.push(line) });
    expect(again.repeated).toEqual([checkout]);
    expect(again.spans).toBe(0);
    expect(again.observed.joins).toEqual(first.observed.joins);
    expect(printed.some((line) => line.endsWith('1 file skipped as already read'))).toBe(true);
  });

  it('starts again with --reset', () => {
    const db = freshDb();
    observe(db, [checkout, series]);
    const reset = observe(db, [billing], { reset: true });
    expect(reset.observed.sources).toHaveLength(1);
    expect(reset.observed.entries['entry:orders:http:POST:/orders']).toBeUndefined();
  });

  it('keeps only the hours inside --since, and keeps cutting the same way until --since all', () => {
    const db = freshDb();
    const all = observe(db, [checkout, series]);
    expect(all.observed.buckets.map((bucket) => bucket.hour)).toEqual(['2025-10-16T07:00:00.000Z', '2025-10-16T08:00:00.000Z']);
    // An hour that ended before 08:30 is gone, with its samples.
    const cut = observe(db, [billing], { since: '1h' });
    expect(cut.observed.window).toEqual({ since: '1h', from: '2025-10-16T08:00:00.000Z', to: '2025-10-16T09:00:00.000Z' });
    expect(cut.observed.entries['entry:orders:http:POST:/orders']).toBeUndefined();
    expect(Object.keys(cut.observed.samples)).toEqual(['entry:billing:http:GET:/invoices/:param', 'entry:billing:http:POST:/invoices']);
    expect(JSON.stringify(cut.observed.samples)).not.toContain('"2025-10-16T07:');
    expect(observe(db, [checkout], { now: new Date('2025-10-16T09:40:00.000Z') }).observed.window.since).toBe('1h');
    expect(observe(db, [series], { since: 'all' }).observed.window.since).toBeUndefined();
  });

  it('refuses a window that is not whole hours', () => {
    expect(() => observe(freshDb(), [checkout], { since: '30m' })).toThrow(/--since takes whole hours/);
  });

  it('refuses to write over a file it cannot read, unless told to start again', () => {
    const db = freshDb();
    writeFileSync(observedPathFor(db), '{ "observedFormatVersion": 3, ');
    expect(() => observe(db, [checkout])).toThrow(/cannot be read .* run again with --reset/);
    expect(observe(db, [checkout], { reset: true }).observed.sources).toHaveLength(1);
  });
});

describe('an older file', () => {
  it('is carried forward as one hour of counts with no timings, and said to be upgraded', () => {
    for (const version of [1, 2]) {
      const db = freshDb();
      const entry = 'entry:billing:http:GET:/invoices/:param';
      writeFileSync(
        observedPathFor(db),
        JSON.stringify({
          observedFormatVersion: version,
          spans: 5,
          joins: {},
          entries: { [entry]: { hits: 5, lastSeen: '2025-10-15T10:20:00.000Z' } },
          symbols: {},
          channels: {},
          unmatched: [],
          ...(version === 2 ? { ambiguous: [] } : {}),
        }),
      );
      const printed: string[] = [];
      const run = observe(db, [billing], { print: (line) => printed.push(line) });
      expect(run.upgradedFrom).toBe(version);
      expect(printed.some((line) => line.startsWith(`upgraded the observed file from format ${version} to 3`))).toBe(true);
      expect(run.observed.buckets[0]).toMatchObject({ hour: '2025-10-15T10:00:00.000Z', entries: { [entry]: { count: 5, carried: 5 } } });
      // Six hits, one of them timed; the error rate is over the one whose outcome is known.
      expect(run.observed.entries[entry]).toMatchObject({ hits: 6, p95: 1.1, errors: 0, errorRate: 0 });
      expect(readObserved(observedPathFor(db)).observed?.observedFormatVersion).toBe(3);
    }
  });
});

describe('what the file keeps', () => {
  it('says in its privacy block what it kept and dropped, as fixed text and counts', () => {
    const db = freshDb();
    const { observed } = observe(db, [checkout, billing, series]);
    expect(observed.privacy.kept).toContain('durationMs');
    expect(observed.privacy.dropped).toContain('request and response headers');
    expect(observed.privacy.droppedAttributes).toBeGreaterThan(0);
    expect(observed.privacy.samples).toEqual({ kept: true, perEntry: 3, spansPerSample: 200 });
    const text = fileOf(db);
    for (const secret of PLANTED) expect(text).not.toContain(secret);
    // Ids appear only in samples.
    const { samples: _samples, ...rest } = JSON.parse(text);
    expect(JSON.stringify(rest)).not.toMatch(/"(traceId|spanId|parentId)":/);
  });

  it('holds no trace id at all with --no-samples, and removes the samples it had', () => {
    const db = freshDb();
    expect(Object.keys(observe(db, [checkout, series]).observed.samples).length).toBeGreaterThan(0);
    const { observed } = observe(db, [billing], { samples: false });
    expect(observed.samples).toEqual({});
    expect(observed.privacy.samples.kept).toBe(false);
    const text = fileOf(db);
    // No 32- or 16-hex run that stands alone; a source's 64-hex hash is not an id.
    expect(text).not.toMatch(/(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{16})(?![0-9a-f])/);
    for (const id of ['a1000000000000000000000000000001', 'b100000000000001', 'e1000000000000000000000000000001']) {
      expect(text).not.toContain(id);
    }
  });
});
