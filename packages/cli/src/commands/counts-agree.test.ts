import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openGraphDb, type GraphDb } from '@flowatlas/linker';
import { summariseProject } from '@flowatlas/mcp';
import { afterAll, describe, expect, it } from 'vitest';
import { packGraph } from '../visualise/pack.js';
import { buildProject, unresolvedLine } from './build.js';
import { runDoctorCommand } from './doctor.js';

/**
 * P81: one database, one set of numbers.
 *
 * The build line, doctor, the page and the MCP server's first answer each say
 * how much was missed, how many rows are notes on how a join was made, and how
 * many are findings about the code. Each used to count for itself, and they
 * disagreed; now each asks `countsOf`, and this reads all four over one
 * fixture's database. The fixtures are chosen for what they hold: joins made
 * from the repositories' files, likely N+1s and a write no notification takes,
 * routes with no guard, a package read from its source.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const quiet = { out(): void {}, err(): void {}, tty: false };

const FIXTURES = [
  'multi-repo-base-urls',
  'lambda-terraform-bucket-notification',
  'multi-repo',
  'uninstalled-internal-packages',
] as const;

const withDb = <T>(fixture: string, read: (db: GraphDb) => T): T => {
  const db = openGraphDb(join(ROOT, 'fixtures', fixture, '.flowatlas', 'graph.db'), { readonly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
};

interface Said {
  missed: number;
  notes: number;
  findings: number;
}

const surfaces = (fixture: string): Record<'build' | 'line' | 'doctor' | 'page' | 'mcp', Said> =>
  withDb(fixture, (db) => {
    const report = db.report();
    if (report === undefined) throw new Error(`${fixture} holds no report; run the fixtures first`);
    const rows = db.allUnresolved();
    const line = /^missed: (\d+).* · notes: (\d+) · findings: (\d+)/.exec(unresolvedLine(rows));
    const doctor = runDoctorCommand({ config: join(ROOT, 'fixtures', fixture, 'flowatlas.config.json'), baseline: false }, quiet)
      .report.unresolved;
    const page = packGraph({ builtAt: report.builtAt, nodes: db.allNodes(), edges: db.allEdges(), unresolved: rows, report })
      .report as { totals: Said };
    const mcp = summariseProject({ nodes: db.allNodes(), channelEnds: new Map(), unresolved: rows }).counts;
    return {
      build: { missed: report.totals.missed, notes: report.totals.notes, findings: report.totals.findings },
      line: { missed: Number(line?.[1]), notes: Number(line?.[2]), findings: Number(line?.[3]) },
      doctor: { missed: doctor.rows, notes: doctor.notes, findings: doctor.findings },
      page: { missed: page.totals.missed, notes: page.totals.notes, findings: page.totals.findings },
      mcp: { missed: mcp.gaps, notes: mcp.notes, findings: mcp.findings },
    };
  });

describe('the numbers every surface says about one database', () => {
  it.each(FIXTURES)('are the same on %s', (fixture) => {
    const said = surfaces(fixture);
    for (const surface of ['line', 'doctor', 'page', 'mcp'] as const) expect(said[surface], surface).toEqual(said.build);
  });

  it('count joins made from files as notes, and likely N+1s and routes with no guard as findings', () => {
    expect(surfaces('multi-repo-base-urls').build.notes).toBeGreaterThan(0);
    expect(surfaces('lambda-terraform-bucket-notification').build.findings).toBeGreaterThan(0);
    expect(surfaces('multi-repo').build.findings).toBeGreaterThan(0);
    expect(surfaces('uninstalled-internal-packages').build.notes).toBeGreaterThan(0);
  });

  it('keep the deprecated alias equal to what was missed', () => {
    for (const fixture of FIXTURES) {
      withDb(fixture, (db) => expect(db.report()?.totals.unresolved).toBe(db.report()?.totals.missed));
    }
  });
});

describe('a join made from the repositories’ files', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-counts-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  // The same project with the files' values unread: every request joined from
  // one is a gap again, so what was missed rises by exactly those requests.
  it('lowers what was missed by the requests it joined', async () => {
    const fixture = join(ROOT, 'fixtures', 'multi-repo-base-urls');
    const config = join(scratch, 'flowatlas.config.json');
    writeFileSync(
      config,
      JSON.stringify({
        services: ['storefront', 'orders', 'payments', 'catalog'].map((name) => ({ name, repo: join(fixture, name), type: 'nestjs' })),
        settingFiles: { read: false },
        output: '.flowatlas',
      }),
    );
    const unread = await buildProject({ config, builtAt: '2026-01-01T00:00:00.000Z', print: () => {} });
    const read = withDb('multi-repo-base-urls', (db) => ({
      totals: db.report()?.totals,
      // Read off as well: a setting taken by its name is taken only where the
      // files that were read give it no value.
      fromFiles: db
        .allUnresolved()
        .filter((row) => row.reason === 'base-url-from-files' || row.reason === 'base-url-from-name')
        .reduce((sum, row) => sum + row.sites, 0),
    }));
    expect(read.fromFiles).toBeGreaterThan(0);
    expect(unread.report.totals.missed - (read.totals?.missed ?? 0)).toBe(read.fromFiles);
    expect(unread.report.totals.notes).toBe(0);
    expect(unread.project.unresolved.every((row) => row.reason === 'unknown-base-url-env')).toBe(true);
  }, 240_000);
});
