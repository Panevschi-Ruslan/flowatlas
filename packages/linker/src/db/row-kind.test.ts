import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { kindOfRow, riskOf, rowClassOf, SCHEMA_VERSION, type ProjectGraph, type Unresolved } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { LinkReport } from '../report.js';
import { openGraphDb } from './reader.js';
import { GRAPH_DB_FORMAT_VERSION } from './schema.js';
import { writeGraphDb } from './writer.js';

/**
 * A row's kind stored on the row (P208): written once by the database writer
 * through core's `kindOfRow`, read back by every reader, and decided again,
 * the same way, from a database written before the column existed.
 */

const FIXED = '2026-01-01T00:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'flowatlas-row-kind-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const ROWS: Unresolved[] = [
  { service: 'orders', file: 'src/a.ts', line: 3, reason: 'channel-dynamic', message: 'built at run time', symbol: 'orders#A.run' },
  { service: 'orders', file: 'src/b.ts', line: 4, reason: 'base-url-from-files', level: 'info', message: 'joined from .env' },
  { service: 'orders', file: 'src/c.ts', line: 5, reason: 'query-in-loop', level: 'info', message: 'a query per item', symbol: 'orders#C.each' },
  { service: 'orders', file: 'src/d.ts', line: 6, reason: 'query-in-loop', level: 'info', message: 'a write per row on purpose', meta: { severity: 'note' }, symbol: 'orders#D.each' },
  { service: 'orders', file: 'src/e.ts', line: 7, reason: 'route-unguarded', message: 'nothing in front of it' },
  { service: 'orders', file: 'src/f.ts', line: 8, reason: 'stream-no-writer', level: 'info', message: 'nothing writes it' },
  { service: 'orders', file: 'src/g.ts', line: 9, reason: 'a-reason-from-a-newer-tool', message: 'unknown here' },
];

const project = (): ProjectGraph => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: '@flowatlas/extractor-nestjs' }],
  nodes: [],
  edges: [],
  types: {},
  unresolved: ROWS,
});

const report = { schemaVersion: SCHEMA_VERSION, builtAt: FIXED, configHash: 'abc', services: [] } as unknown as LinkReport;

let written = 0;
const write = (): string => {
  written += 1;
  const path = join(dir, `graph-${written}.db`);
  writeGraphDb(project(), report, path);
  return path;
};

/** What every reader expects of a row: what `kindOfRow` and `riskOf` decide for it. */
const decided = (row: { reason: string; meta?: Record<string, unknown> }) => {
  const kind = kindOfRow(row);
  const risk = kind === 'finding' ? riskOf(row.reason) : undefined;
  return { kind, ...(risk === undefined ? {} : { risk }) };
};

describe("a row's kind, stored on the row (P208)", () => {
  it('writes the kind and a finding\'s risk into their columns, and says the layout version', () => {
    const path = write();
    const raw = new Database(path, { readonly: true });
    try {
      const stored = raw.prepare('SELECT reason, kind, risk FROM unresolved ORDER BY file').all();
      expect(stored).toEqual([
        { reason: 'channel-dynamic', kind: 'gap', risk: null },
        { reason: 'base-url-from-files', kind: 'note', risk: null },
        { reason: 'query-in-loop', kind: 'finding', risk: 'performance' },
        // A loop per item on purpose is a note (P89), and a note has no risk.
        { reason: 'query-in-loop', kind: 'note', risk: null },
        { reason: 'route-unguarded', kind: 'finding', risk: 'auth' },
        { reason: 'stream-no-writer', kind: 'finding', risk: 'wiring' },
        { reason: 'a-reason-from-a-newer-tool', kind: 'gap', risk: null },
      ]);
    } finally {
      raw.close();
    }
    const db = openGraphDb(path);
    expect(db.formatVersion()).toBe(GRAPH_DB_FORMAT_VERSION);
    db.close();
  });

  it('reads every row back with the kind stored, never one kindOfRow would not give', () => {
    const db = openGraphDb(write());
    try {
      const rows = db.allUnresolved();
      expect(rows.map((row) => [row.file, row.kind, row.risk])).toEqual([
        ['src/a.ts', 'gap', undefined],
        ['src/b.ts', 'note', undefined],
        ['src/c.ts', 'finding', 'performance'],
        ['src/d.ts', 'note', undefined],
        ['src/e.ts', 'finding', 'auth'],
        ['src/f.ts', 'finding', 'wiring'],
        ['src/g.ts', 'gap', undefined],
      ]);
      for (const row of rows) expect({ kind: row.kind, ...(row.risk === undefined ? {} : { risk: row.risk }) }, row.reason).toEqual(decided(row));
      expect(db.unresolvedFor('orders#D.each').map((row) => row.kind)).toEqual(['note']);
      expect(db.unresolvedFor('orders#C.each').map((row) => [row.kind, row.risk])).toEqual([['finding', 'performance']]);
    } finally {
      db.close();
    }
  });

  it('reads the stored answer, not a fresh one: a stored kind is what the reader hands on', () => {
    const path = write();
    const raw = new Database(path);
    raw.prepare("UPDATE unresolved SET kind = 'note' WHERE reason = 'channel-dynamic'").run();
    raw.close();
    const db = openGraphDb(path);
    try {
      expect(db.allUnresolved().find((row) => row.reason === 'channel-dynamic')?.kind).toBe('note');
    } finally {
      db.close();
    }
  });

  it('reads a database written before the columns existed by deciding each kind as before', () => {
    const path = write();
    const raw = new Database(path);
    raw.exec("ALTER TABLE unresolved DROP COLUMN kind; ALTER TABLE unresolved DROP COLUMN risk; DELETE FROM meta WHERE key = 'db_format_version';");
    raw.close();
    const db = openGraphDb(path);
    try {
      expect(db.formatVersion()).toBe(1);
      const rows = db.allUnresolved();
      expect(rows).toHaveLength(ROWS.length);
      for (const row of rows) expect({ kind: row.kind, ...(row.risk === undefined ? {} : { risk: row.risk }) }, row.reason).toEqual(decided(row));
      expect(db.unresolvedFor('orders#D.each').map((row) => row.kind)).toEqual(['note']);
    } finally {
      db.close();
    }
  });

  it('reads a database older still, without the meta column, as before: the query-in-loop note is a finding without its meta', () => {
    const path = write();
    const raw = new Database(path);
    raw.exec('ALTER TABLE unresolved DROP COLUMN kind; ALTER TABLE unresolved DROP COLUMN risk; ALTER TABLE unresolved DROP COLUMN meta;');
    raw.close();
    const db = openGraphDb(path);
    try {
      const rows = db.allUnresolved();
      expect(rows.every((row) => row.meta === undefined)).toBe(true);
      expect(rows.find((row) => row.file === 'src/d.ts')?.kind).toBe('finding');
    } finally {
      db.close();
    }
  });
});

describe('every fixture database: a reader never disagrees with kindOfRow (P208)', () => {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'fixtures');
  const databases = readdirSync(fixtures, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(fixtures, entry.name, '.flowatlas', 'graph.db'))
    .filter((path) => existsSync(path));

  it.skipIf(databases.length === 0)('stores, for every row of every built fixture, the kind and risk core decides', () => {
    let rows = 0;
    for (const path of databases) {
      const db = openGraphDb(path);
      try {
        if (db.formatVersion() < GRAPH_DB_FORMAT_VERSION) continue;
        for (const row of db.allUnresolved()) {
          rows += 1;
          expect({ kind: row.kind, ...(row.risk === undefined ? {} : { risk: row.risk }) }, `${path} ${row.reason}`).toEqual(rowClassOf(row));
        }
      } finally {
        db.close();
      }
    }
    expect(rows).toBeGreaterThan(0);
  });
});
