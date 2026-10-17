import type { Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { compareBaseline, snapshotOf, unresolvedKey, type Baseline } from './baseline.js';
import { BASELINE_FORMAT_VERSION } from './schema.js';

const row = (over: Partial<Unresolved> = {}): Unresolved => ({
  service: 'orders',
  file: 'src/orders.service.ts',
  line: 12,
  reason: 'dynamic-http-url',
  ...over,
});

const baselineOf = (rows: readonly Unresolved[], ignoreReasons: string[] = []): Baseline => ({
  baselineFormatVersion: BASELINE_FORMAT_VERSION,
  schemaVersion: 3,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  acceptedBy: 'test',
  flowatlasVersion: '0.1.0',
  graph: { builtAt: '2026-01-01T00:00:00.000Z', services: {} },
  unresolved: snapshotOf(rows, { ignoreReasons }),
  markers: { warnings: 0 },
  contracts: { warnings: 0, infos: 0, ignored: 0 },
});

describe('what a baseline counts', () => {
  it('names a row by where it is and what it is, never by which line it sits on', () => {
    // A row that moves down a file is the same row. Keying on the line would
    // make every edit above it look like a new finding and an old one gone.
    expect(unresolvedKey(row({ line: 12 }))).toBe(unresolvedKey(row({ line: 400 })));
  });

  it('counts places rather than rows, so a folded row stands for all of them', () => {
    const snapshot = snapshotOf([row({ sites: 40 }), row({ file: 'b.ts', sites: 2 })]);
    expect(snapshot.total).toBe(42);
  });

  it('leaves the informational rows out of the total and says how many there were', () => {
    // They describe the tool's own limits, so no edit to the repository removes
    // them and growing on them would fail a build nobody could fix.
    const snapshot = snapshotOf([row(), row({ level: 'info', sites: 333, file: 'x.ts' })]);
    expect(snapshot.total).toBe(1);
    expect(snapshot.info).toEqual({ rows: 1, sites: 333 });
  });

  it('counts a place where nothing joins apart from the places it could not read', () => {
    // A template binding that assigns to a field has no other end in any
    // project. Counting it beside a receiver whose class could not be resolved
    // would make both numbers mean less than either does alone.
    const snapshot = snapshotOf([
      row(),
      row({ level: 'info', sites: 192, file: 'x.ts' }),
      row({ level: 'nothing', sites: 397, file: 'y.ts', reason: 'handler-not-a-method' }),
    ]);
    expect(snapshot.total).toBe(1);
    expect(snapshot.info).toEqual({ rows: 1, sites: 192 });
    expect(snapshot.nothing).toEqual({ rows: 1, sites: 397 });
  });

  // P81, D3: kinds are for people reading the numbers. A CI gate counts what it
  // counted before - every actionable row, findings included - so a baseline
  // accepted before kinds existed gives the same verdict after.
  it('keeps counting every actionable row, findings included, whatever its kind', () => {
    const rows = [
      row(),
      row({ reason: 'route-unguarded', file: 'routes.ts' }),
      row({ reason: 'query-in-loop', level: 'info', sites: 1, file: 'loop.ts' }),
      row({ reason: 'base-url-from-files', level: 'info', sites: 3, file: 'client.ts' }),
    ];
    const snapshot = snapshotOf(rows);
    // What the total was before kinds: the sites of every row at `action`.
    const before = rows.filter((item) => (item.level ?? 'action') === 'action').reduce((sum, item) => sum + (item.sites ?? 1), 0);
    expect(snapshot.total).toBe(before);
    expect(snapshot.keys.map((key) => key.key)).toEqual([
      unresolvedKey(row()),
      unresolvedKey(row({ reason: 'route-unguarded', file: 'routes.ts' })),
    ].sort());
    // A note or a finding at `info` is no limit of static reading.
    expect(snapshot.info).toEqual({ rows: 0, sites: 0 });
    expect(snapshot.nothing).toEqual({ rows: 0, sites: 0 });
    expect(compareBaseline(snapshot, { baseline: baselineOf(rows) }).status).toBe('ok');
  });

  it('takes an ignored reason out of the total and out of the keys', () => {
    const rows = [row(), row({ reason: 'known-noise', file: 'b.ts' })];
    const snapshot = snapshotOf(rows, { ignoreReasons: ['known-noise'] });
    expect(snapshot.total).toBe(1);
    expect(snapshot.keys.map((entry) => entry.key)).toEqual([unresolvedKey(row())]);
  });
});

describe('comparing a project against its baseline', () => {
  it('is unmoved by a row that only changed line', () => {
    const before = baselineOf([row({ line: 12 })]);
    const delta = compareBaseline(snapshotOf([row({ line: 400 })]), { baseline: before });
    expect(delta).toMatchObject({ status: 'ok', newKeys: [], goneKeys: [] });
    expect(delta.total.delta).toBe(0);
  });

  it('names both ends when a row moves to another file, and still passes', () => {
    // The count did not change, so nothing got worse. A reader still wants to
    // know which one went and which one arrived.
    const before = baselineOf([row({ file: 'a.ts' })]);
    const delta = compareBaseline(snapshotOf([row({ file: 'b.ts' })]), { baseline: before });
    expect(delta.status).toBe('ok');
    expect(delta.newKeys).toHaveLength(1);
    expect(delta.goneKeys).toHaveLength(1);
  });

  it('fails on one row more than was accepted', () => {
    const before = baselineOf([row()]);
    const delta = compareBaseline(snapshotOf([row(), row({ file: 'b.ts' })]), { baseline: before });
    expect(delta.status).toBe('grew');
    expect(delta.total.delta).toBe(1);
  });

  it('passes on one row fewer, and says so', () => {
    const before = baselineOf([row(), row({ file: 'b.ts' })]);
    const delta = compareBaseline(snapshotOf([row()]), { baseline: before });
    expect(delta.status).toBe('ok');
    expect(delta.total.delta).toBe(-1);
  });

  it('treats a baseline that is not there as everything being new', () => {
    const delta = compareBaseline(snapshotOf([row()]), {
      status: 'missing',
      note: 'no baseline has been accepted',
    });
    expect(delta.status).toBe('missing');
    expect(delta.newKeys).toHaveLength(1);
  });

  it('says nothing at all when no baseline was asked for', () => {
    expect(compareBaseline(snapshotOf([row()]), undefined)).toMatchObject({ status: 'skipped' });
  });

  it('compares across a schema change, and warns that the count can move on its own', () => {
    const before = baselineOf([row()]);
    const delta = compareBaseline(snapshotOf([row()]), { baseline: before }, { schemaVersion: 4 });
    expect(delta.status).toBe('ok');
    expect(delta.note).toContain('schema');
  });
});
