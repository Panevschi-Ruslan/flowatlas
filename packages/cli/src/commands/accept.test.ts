import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readAccepted } from '@flowatlas/core';
import { createFlowatlasServer } from '@flowatlas/mcp';
import { acceptedSplitOf, openGraphDb, type GraphDb } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { packGraph } from '../visualise/pack.js';
import { runAccept } from './accept.js';
import { runCantFollowCommand, runDoctorCommand } from './doctor.js';

/** The page's data, packed as `visualise` packs it: through the one split (P80). */
const pagePacked = (graph: GraphDb, dbPath: string) => {
  const report = graph.report()!;
  const split = acceptedSplitOf(graph, graph.allUnresolved(), readAccepted(dbPath));
  return packGraph({
    builtAt: report.builtAt,
    nodes: graph.allNodes(),
    edges: graph.allEdges(),
    unresolved: split.rows,
    report,
    accepted: split,
  });
};

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
    expect(readAccepted(db).gaps).toEqual([{ reason, note: 'known', acceptedAt: '2026-01-01T00:00:00.000Z' }]);

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
      const packed = pagePacked(graph, db);
      expect(packed.accepted?.rows).toContain(0);
      expect(packed.accepted?.ids['0']).toBe(id);
      expect(packed.accepted?.rows.every((index) => packed.accepted?.ids[String(index)] === id)).toBe(true);
      runAccept(id, { db, remove: true, print: silent });
      expect(existsSync(join(db, '..', 'accepted.json'))).toBe(true);
      expect(readAccepted(db).gaps).toEqual([]);
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
    expect(readAccepted(accessDb).gaps).toEqual([]);
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
    expect(readAccepted(accessDb).gaps).toEqual([
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
      const packed = pagePacked(graph, accessDb);
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

describe('flowatlas accept, over a file it cannot read (P80)', () => {
  const AT = '2026-01-01T00:00:00.000Z';
  let brokenDb: string;
  let file: string;
  let reason: string;

  /** A file with several entries, as a project would have after a while. */
  beforeAll(() => {
    const directory = mkdtempSync(join(tmpdir(), 'flowatlas-accept-broken-'));
    cpSync(BUILT, directory, { recursive: true });
    brokenDb = join(directory, 'graph.db');
    file = join(directory, 'accepted.json');
    const graph = openGraphDb(brokenDb, { readonly: true });
    const rows = graph.allUnresolved();
    graph.close();
    reason = rows[0]!.reason;
    runAccept(reason, { db: brokenDb, note: 'one', acceptedAt: AT, print: silent });
    runAccept(`gap:${rows[1]!.service ?? ''}|${rows[1]!.file ?? ''}|${rows[1]!.reason}`, { db: brokenDb, note: 'two', acceptedAt: AT, print: silent });
    expect(readAccepted(brokenDb).gaps.length).toBe(2);
  });

  const BROKEN: Array<[string, (good: string) => string, RegExp]> = [
    ['a syntax error', (good) => `${good}}`, /cannot be read \(.*JSON.*\); nothing was written/],
    ['a merge conflict', (good) => `<<<<<<< HEAD\n${good}=======\n${good}>>>>>>> branch\n`, /cannot be read/],
    ['a file from a newer flowatlas', (good) => good.replace('"acceptedFormatVersion": 2', '"acceptedFormatVersion": 3'), /written by a newer flowatlas.*upgrade to change it\); nothing was written/],
    ['an entry without a reason', (good) => good.replace(/"reason": "[^"]+",/, ''), /gaps\.\d+\.reason/],
  ];

  it.each(BROKEN)('refuses to add or remove over %s, and leaves the bytes as they were', (_name, breakIt, said) => {
    const good = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, breakIt(good));
      const before = readFileSync(file);
      expect(() => runAccept(reason, { db: brokenDb, service: 'nowhere', note: 'x', print: silent })).toThrow(said);
      expect(() => runAccept(reason, { db: brokenDb, note: 'replaced', print: silent })).toThrow(said);
      expect(() => runAccept(reason, { db: brokenDb, remove: true, print: silent })).toThrow(said);
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      writeFileSync(file, good);
    }
    expect(readAccepted(brokenDb).gaps.length).toBe(2);
  });

  it('names the file and how to get out, in the refusal itself', () => {
    const good = readFileSync(file, 'utf8');
    try {
      appendFileSync(file, '}');
      let error: unknown;
      try {
        runAccept(reason, { db: brokenDb, print: silent });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 2, details: ['Fix or move the file; flowatlas accept --list shows what it holds once it reads.'] });
      expect((error as Error).message.startsWith(`accepted.json at ${file} cannot be read (`)).toBe(true);
    } finally {
      writeFileSync(file, good);
    }
  });

  it('still lists and dry-runs, saying the problem first, and writes nothing', () => {
    const good = readFileSync(file, 'utf8');
    try {
      appendFileSync(file, '}');
      const before = readFileSync(file);
      const listed: string[] = [];
      const list = runAccept(undefined, { db: brokenDb, list: true, print: (line) => listed.push(line) });
      expect(list.problem?.kind).toBe('unparseable');
      expect(listed[0]).toMatch(/^accepted\.json at .* cannot be read \(.*\), so nothing in it is accepted\.$/);
      expect(listed).not.toContain('no gap is accepted');
      const dry: string[] = [];
      const run = runAccept(reason, { db: brokenDb, dryRun: true, print: (line) => dry.push(line) });
      expect(dry[0]).toMatch(/cannot be read .*; writing this would be refused\.$/);
      expect(dry[1]).toMatch(/^would accept: /);
      expect(run.covered).toBeGreaterThan(0);
      expect(readFileSync(file).equals(before)).toBe(true);
    } finally {
      writeFileSync(file, good);
    }
  });

  it('is said by doctor, which then counts every gap as new', () => {
    const report = () => runDoctorCommand({ db: brokenDb, baseline: false, out: join(brokenDb, '..', 'out') }, quiet);
    const good = readFileSync(file, 'utf8');
    const accepted = report().report.unresolved;
    expect(accepted.accepted?.rows).toBeGreaterThan(0);
    try {
      appendFileSync(file, '}');
      const run = report();
      expect(run.report.unresolved.accepted).toMatchObject({ rows: 0, sites: 0, problem: { kind: 'unparseable', path: file } });
      expect(run.report.unresolved.sites).toBe(accepted.sites + accepted.accepted!.sites);
      expect(run.text).toMatch(/warning: accepted\.json at .* cannot be read \(.*\), so nothing in it is accepted; every gap is counted as new/);
      const json = JSON.parse(runDoctorCommand({ db: brokenDb, baseline: false, format: 'json', out: join(brokenDb, '..', 'out') }, quiet).text);
      expect(json.unresolved.accepted.problem.kind).toBe('unparseable');
      const github = runDoctorCommand({ db: brokenDb, baseline: false, format: 'github', out: join(brokenDb, '..', 'out') }, quiet).text;
      expect(github).toContain('::warning title=accepted.json cannot be read::');
      const unresolved = runCantFollowCommand({ db: brokenDb }, quiet);
      expect(unresolved.report.accepted?.problem?.kind).toBe('unparseable');
      expect(unresolved.text).toMatch(/warning: accepted\.json at .* cannot be read/);
      expect(readFileSync(file, 'utf8')).toBe(`${good}}`);
    } finally {
      writeFileSync(file, good);
    }
  });
});

describe('one route rule, one answer on every surface (P80)', () => {
  const ACCESS = join(ROOT, 'fixtures', 'nest-route-access', '.flowatlas');

  /** What each of doctor, doctor --unresolved, the page and MCP cant_follow left out as accepted. */
  const surfaces = async (dbPath: string) => {
    const out = join(dbPath, '..', 'out');
    const doctor = runDoctorCommand({ db: dbPath, baseline: false, out }, quiet).report.unresolved.accepted?.rows ?? 0;
    const unresolved = runCantFollowCommand({ db: dbPath }, quiet).report.accepted?.rows ?? 0;
    const graph = openGraphDb(dbPath, { readonly: true });
    let page: number;
    try {
      page = pagePacked(graph, dbPath).accepted?.rows.length ?? 0;
    } finally {
      graph.close();
    }
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowatlasServer({ dbPath }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    try {
      const response = (await client.callTool({ name: 'cant_follow', arguments: {} })) as { content: Array<{ text: string }> };
      const mcp = (JSON.parse(response.content[0]!.text) as { accepted?: { rows: number } }).accepted?.rows ?? 0;
      return { doctor, unresolved, page, mcp };
    } finally {
      await client.close();
    }
  };

  it.each([
    ['rows read from the graph file, with their symbols', false],
    ['rows read back from the database, without them', true],
  ])('takes the same rows everywhere: %s', async (_name, withoutGraphFile) => {
    const directory = mkdtempSync(join(tmpdir(), 'flowatlas-accept-surfaces-'));
    cpSync(ACCESS, directory, { recursive: true });
    const dbPath = join(directory, 'graph.db');
    if (withoutGraphFile) rmSync(join(directory, 'project-graph.json'));
    runAccept('route-unguarded', {
      db: dbPath,
      service: 'inventory',
      path: 'GET /levels/*',
      note: 'stock levels are published on purpose',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      print: silent,
    });
    expect(await surfaces(dbPath)).toEqual({ doctor: 2, unresolved: 2, page: 2, mcp: 2 });
  });
});

