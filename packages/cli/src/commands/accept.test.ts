import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadAccepted } from '@flowatlas/core';
import { openGraphDb } from '@flowatlas/linker';
import { beforeAll, describe, expect, it } from 'vitest';
import { packGraph } from '../visualise/pack.js';
import { runAccept } from './accept.js';
import { runDoctorCommand } from './doctor.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const BUILT = join(ROOT, 'fixtures', 'multi-repo-doctor', '.flowatlas');

const quiet = { out(): void {}, err(): void {}, tty: false };
const silent = (): void => {};

let db: string;

/** A copy of the built fixture, so accepting writes nowhere a snapshot reads. */
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-accept-'));
  cpSync(BUILT, directory, { recursive: true });
  db = join(directory, 'graph.db');
});

const doctor = () => runDoctorCommand({ db, baseline: false, out: join(db, '..', 'out') }, quiet).report;

describe('flowatlas accept', () => {
  it('takes an accepted reason out of what doctor counts, and says how many it left out', () => {
    const before = doctor();
    const reason = before.unresolved.byReason.find((group) => group.level === 'action')!.reason;
    const run = runAccept(reason, { db, note: 'known', acceptedAt: '2026-01-01T00:00:00.000Z', print: silent });
    expect(run.covered).toBeGreaterThan(0);
    expect(loadAccepted(db)).toEqual([{ reason, note: 'known', acceptedAt: '2026-01-01T00:00:00.000Z' }]);

    const after = doctor();
    expect(after.unresolved.byReason.map((group) => group.reason)).not.toContain(reason);
    expect(after.unresolved.accepted?.rows).toBeGreaterThan(0);
    expect(after.unresolved.total).toBeLessThan(before.unresolved.total);

    runAccept(reason, { db, remove: true, print: silent });
    expect(doctor().unresolved.total).toBe(before.unresolved.total);
  });

  it('refuses a reason no gap has, so a typo is not accepted silently', () => {
    expect(() => runAccept('no-such-reason', { db, print: silent })).toThrow(/no gap in this graph/);
  });

  it('accepts one place by its gap id, and the page marks only that row', () => {
    const graph = openGraphDb(db, { readonly: true });
    try {
      const rows = graph.allUnresolved();
      const first = rows[0]!;
      const id = `gap:${first.service ?? ''}|${first.file ?? ''}|${first.reason}`;
      runAccept(id, { db, print: silent });
      const report = graph.report()!;
      const packed = packGraph({
        builtAt: report.builtAt,
        nodes: graph.allNodes(),
        edges: graph.allEdges(),
        unresolved: rows,
        report,
        accepted: loadAccepted(db),
      });
      expect(packed.accepted?.rows).toContain(0);
      expect(packed.accepted?.ids['0']).toBe(id);
      expect(packed.accepted?.rows.every((index) => packed.accepted?.ids[String(index)] === id)).toBe(true);
      runAccept(id, { db, remove: true, print: silent });
      expect(existsSync(join(db, '..', 'accepted.json'))).toBe(true);
      expect(loadAccepted(db)).toEqual([]);
    } finally {
      graph.close();
    }
  });
});

describe('flowatlas accept, by rule (P76)', () => {
  const ACCESS = join(ROOT, 'fixtures', 'nest-route-access', '.flowatlas');
  let accessDb: string;
  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), 'flowatlas-accept-rule-'));
    cpSync(ACCESS, directory, { recursive: true });
    accessDb = join(directory, 'graph.db');
  });
  const unguarded = () =>
    runDoctorCommand({ db: accessDb, baseline: false, out: join(accessDb, '..', 'out') }, quiet).report.unresolved.byReason.find(
      (group) => group.reason === 'route-unguarded',
    );

  it('lists what a route pattern would take, and writes nothing', () => {
    const lines: string[] = [];
    const run = runAccept('route-unguarded', {
      db: accessDb,
      service: 'inventory',
      path: 'GET /levels/*',
      dryRun: true,
      print: (line) => lines.push(line),
    });
    expect(run.covered).toBe(2);
    expect(run.matched?.map((line) => line.split('  ')[1])).toEqual([
      'src/stock/levels.controller.ts:15',
      'src/stock/levels.controller.ts:20',
    ]);
    expect(lines[0]).toBe('would accept: route-unguarded · service inventory · path GET /levels/* (2 gaps)');
    expect(loadAccepted(accessDb)).toEqual([]);
  });

  it('refuses a rule with no reason, and one that matches nothing', () => {
    expect(() => runAccept('route-unguarded', { db: accessDb, service: 'inventory', path: 'GET /levels/*', print: silent })).toThrow(
      /needs a reason/,
    );
    expect(() =>
      runAccept('route-unguarded', { db: accessDb, path: 'GET /nowhere/*', note: 'x', print: silent }),
    ).toThrow(/no gap in this graph matches route-unguarded · path GET \/nowhere\/\*/);
  });

  it('takes every route the pattern names out of doctor, and the page says which rule took them', () => {
    expect(unguarded()?.count).toBe(2);
    runAccept('route-unguarded', {
      db: accessDb,
      service: 'inventory',
      path: 'GET /levels/*',
      note: 'stock levels are published on purpose',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      print: silent,
    });
    expect(loadAccepted(accessDb)).toEqual([
      {
        reason: 'route-unguarded',
        service: 'inventory',
        path: 'GET /levels/*',
        note: 'stock levels are published on purpose',
        acceptedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(unguarded()).toBeUndefined();

    const graph = openGraphDb(accessDb, { readonly: true });
    try {
      const rows = graph.allUnresolved();
      const report = graph.report()!;
      const packed = packGraph({
        builtAt: report.builtAt,
        nodes: graph.allNodes(),
        edges: graph.allEdges(),
        unresolved: rows,
        report,
        accepted: loadAccepted(accessDb),
      });
      expect(packed.accepted?.rules).toEqual(['route-unguarded · service inventory · path GET /levels/*']);
      expect(Object.keys(packed.accepted?.byRule ?? {})).toHaveLength(2);
      // The checked-in-body route and the others are not taken by it.
      expect(packed.accepted?.rows).toHaveLength(2);
      expect(Object.keys(packed.access ?? {}).length).toBeGreaterThan(0);
    } finally {
      graph.close();
    }
    runAccept('route-unguarded', { db: accessDb, service: 'inventory', path: 'GET /levels/*', remove: true, print: silent });
    expect(unguarded()?.count).toBe(2);
  });
});

