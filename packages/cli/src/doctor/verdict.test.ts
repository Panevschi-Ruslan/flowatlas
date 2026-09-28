import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGraphDb, writeGraphDb, type GraphDb, type LinkReport, type ServiceReport } from '@flowatlas/linker';
import { SCHEMA_VERSION, type GraphNode, type ProjectGraph, type Unresolved } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotOf, type Baseline } from './baseline.js';
import { runDoctor } from './run.js';
import { BASELINE_FORMAT_VERSION } from './schema.js';

// A real database, because `runDoctor` asks it questions. Which graph it holds
// matters only in that it must be one the check can report on — a graph whose
// every way in was read — since every one of these is about the verdict.
// `buildTestProject` is not that graph: its `billing` entry has no handler,
// which no reader produces for an event and the check now refuses (R94).
let db: GraphDb;
beforeAll(() => {
  db = graphWith({ name: 'doctor-verdict', nodes: 3, services: [reportOf()], ways: { orders: ['read'] } });
});
const dbOf = (): GraphDb => db;

const row = (over: Partial<Unresolved> = {}): Unresolved => ({
  service: 'orders',
  file: 'src/orders.service.ts',
  line: 12,
  reason: 'dynamic-http-url',
  ...over,
});

const baselineOf = (rows: readonly Unresolved[]): Baseline => ({
  baselineFormatVersion: BASELINE_FORMAT_VERSION,
  schemaVersion: 3,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  acceptedBy: 'test',
  flowatlasVersion: '0.1.0',
  graph: { builtAt: '2026-01-01T00:00:00.000Z', services: {} },
  unresolved: snapshotOf(rows),
  markers: { warnings: 0 },
  contracts: { warnings: 0, infos: 0, ignored: 0 },
});

/**
 * A graph with a report of one's own choosing, written and read the way the tool
 * does it.
 *
 * The question these ask is about what the build recorded beside the graph, so
 * the report has to be real rather than mocked: `doctor` reads it out of the
 * database, and a fake object would be testing the test.
 */
const directory = mkdtempSync(join(tmpdir(), 'flowatlas-verdict-'));
const FIXED = '2026-01-01T00:00:00.000Z';
let open: GraphDb[] = [];
afterAll(() => {
  for (const db of open) db.close();
  open = [];
});

/**
 * How the body behind one way in stands: read, never reached by an edge, or
 * reached by an edge onto a handler its adapter said it could not follow.
 */
type Way = 'read' | 'no-edge' | 'edge-unread';

const graphWith = (options: {
  name: string;
  nodes: number;
  services: ServiceReport[];
  /** Ways in per service, each with how its body stands. */
  ways?: Record<string, readonly Way[]>;
}): GraphDb => {
  const plain: GraphNode[] = Array.from({ length: options.nodes }, (_, index) => ({
    id: `gateway#node${index}`,
    type: 'method',
    label: `node${index}`,
    repo: 'gateway',
  }));
  const ways = Object.entries(options.ways ?? {}).flatMap(([repo, list]) =>
    list.map((way, index) => ({ repo, way, id: `${repo}#entry${index}`, handler: `${repo}#handler${index}` })),
  );
  const nodes: GraphNode[] = [
    ...plain,
    ...ways.flatMap(({ repo, way, id, handler }): GraphNode[] => [
      {
        id,
        type: 'entry',
        label: `GET /${id}`,
        repo,
        ...(way === 'edge-unread' ? { meta: { handlerBodyRead: false } } : {}),
      },
      { id: handler, type: 'method', label: handler, repo },
    ]),
  ];
  const edges = ways
    .filter(({ way }) => way !== 'no-edge')
    .map(({ id, handler }) => ({ from: id, to: handler, type: 'handles' as const, confidence: 'static' as const }));
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: options.services.map((service) => ({
      name: service.name,
      repo: service.repo,
      type: service.type,
      extractor: service.extractor,
    })),
    nodes,
    edges,
    types: {},
    unresolved: [],
  };
  const report: LinkReport = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    configHash: 'test',
    services: options.services,
    httpOut: {
      total: 0,
      linked: 0,
      byMarker: 0,
      unknownEnv: 0,
      noRoute: 0,
      ambiguous: 0,
      external: 0,
      dynamic: 0,
    },
    ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
    channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
    routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
    types: { total: 0, sharedPackage: 0 },
    unresolved: [],
    totals: { nodes: nodes.length, edges: edges.length, types: 0, unresolved: 0 },
  };
  const path = join(directory, `${options.name}.db`);
  writeGraphDb(project, report, path);
  const db = openGraphDb(path);
  open.push(db);
  return db;
};

const reportOf = (over: Partial<ServiceReport> = {}): ServiceReport => ({
  name: 'orders',
  repo: './orders',
  type: 'nestjs',
  extractor: '@flowatlas/extractor-nestjs',
  nodes: 12,
  edges: 4,
  types: 0,
  unresolved: 0,
  durationMs: 1,
  ...over,
});

/**
 * The three graphs nobody can be told are healthy.
 *
 * Exit 2 and not 1, and without `--strict`: the argument is written above the
 * check in `run.ts`, and these hold it. Every one of them answered 0 before.
 */
describe('a graph that cannot be reported on', () => {
  it('refuses a graph whose build failed, and names the repository', () => {
    const db = graphWith({
      name: 'failed',
      nodes: 3,
      services: [
        reportOf(),
        reportOf({ name: 'broken', nodes: 0, skipped: 'extract-failed', error: 'exit 2: boom' }),
      ],
    });
    const report = runDoctor({ db, unresolved: [] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(2);
    expect(report.verdict.reasons.join(' ')).toMatch(/the build that wrote this graph failed/);
    expect(report.verdict.reasons.join(' ')).toContain('broken');
  });

  it('refuses a graph with nothing in it', () => {
    const db = graphWith({ name: 'empty', nodes: 0, services: [] });
    const report = runDoctor({ db, unresolved: [] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(2);
    expect(report.verdict.reasons.join(' ')).toMatch(/holds no node at all/);
  });

  it('refuses a graph a service was read into and contributed nothing to', () => {
    const db = graphWith({
      name: 'silent',
      nodes: 3,
      services: [reportOf(), reportOf({ name: 'widget', extractor: '@flowatlas/extractor-react', nodes: 0 })],
    });
    const report = runDoctor({ db, unresolved: [] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(2);
    expect(report.verdict.reasons.join(' ')).toContain('widget');
  });

  it('says nothing about a service with no reader, which is not the same thing', () => {
    // A repository no extractor covers contributes nothing by design, and the
    // build already names it. Failing over it would fail every project that has
    // one of those, for ever.
    const db = graphWith({
      name: 'no-reader',
      nodes: 3,
      services: [reportOf(), reportOf({ name: 'docs', extractor: null, nodes: 0, skipped: 'no-extractor' })],
    });
    expect(runDoctor({ db, unresolved: [] }, { contracts: false }).verdict).toEqual({
      exitCode: 0,
      reasons: [],
    });
  });

  it('leaves a fault about another service out when the run was narrowed', () => {
    const db = graphWith({
      name: 'narrowed',
      nodes: 3,
      services: [reportOf(), reportOf({ name: 'widget', nodes: 0 })],
    });
    const asked = runDoctor({ db, unresolved: [] }, { contracts: false, service: 'orders' });
    expect(asked.verdict.exitCode).toBe(0);
    const about = runDoctor({ db, unresolved: [] }, { contracts: false, service: 'widget' });
    expect(about.verdict.exitCode).toBe(2);
  });
});

/**
 * A service whose ways in were mostly read no further than their addresses
 * (R94): the fourth hat, with the argument written above the check in `run.ts`.
 * The auditor's reproduction — `next-hollow` without `widget`, six ways in and
 * five with no body — answered 0 on every run, `--accept` included.
 */
describe('a service whose ways in mostly have no body that was read', () => {
  const hollow: Way[] = ['read', 'no-edge', 'no-edge', 'edge-unread', 'edge-unread', 'no-edge'];
  const unreadRows = hollow
    .map((way, line) => ({ way, line }))
    .filter(({ way }) => way !== 'read')
    .map(({ line }) => row({ service: 'shop', reason: 'route-handler-unread', line, symbol: `GET /${line}` }));

  it('refuses it, names the service and gives both numbers', () => {
    const db = graphWith({ name: 'hollow', nodes: 1, services: [reportOf({ name: 'shop' })], ways: { shop: hollow } });
    const report = runDoctor({ db, unresolved: unreadRows }, { contracts: false });
    expect(report.verdict.exitCode).toBe(2);
    expect(report.verdict.reasons.join(' ')).toContain('shop: 5 of its 6 ways in have no handler that was read');
    expect(report.unresolved.waysIn).toEqual({ found: 6, read: 1 });
  });

  it('is not something a baseline can excuse, strict or not', () => {
    const db = graphWith({ name: 'hollow-accepted', nodes: 1, services: [reportOf({ name: 'shop' })], ways: { shop: hollow } });
    for (const strict of [false, true]) {
      const report = runDoctor(
        { db, unresolved: unreadRows },
        { contracts: false, strict, baseline: { baseline: baselineOf(unreadRows) } },
      );
      expect(report.baseline.status).toBe('ok');
      expect(report.verdict.exitCode).toBe(2);
    }
  });

  it('leaves a service with a few unread handlers green, and says how many', () => {
    const db = graphWith({
      name: 'few',
      nodes: 1,
      services: [reportOf({ name: 'shop' })],
      ways: { shop: ['read', 'read', 'read', 'read', 'no-edge'] },
    });
    const report = runDoctor({ db, unresolved: [unreadRows[0] as Unresolved] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(0);
    expect(report.unresolved.waysIn).toEqual({ found: 5, read: 4 });
  });

  it('is decided per service, so a service read end to end cannot carry a hollow one', () => {
    const db = graphWith({
      name: 'outnumbered',
      nodes: 1,
      services: [reportOf(), reportOf({ name: 'shop' })],
      ways: { orders: Array.from({ length: 20 }, (): Way => 'read'), shop: hollow },
    });
    const report = runDoctor({ db, unresolved: unreadRows }, { contracts: false });
    expect(report.unresolved.waysIn).toEqual({ found: 26, read: 21 });
    expect(report.verdict.exitCode).toBe(2);
    expect(report.verdict.reasons.join(' ')).toMatch(/^shop: /);
    expect(runDoctor({ db, unresolved: [] }, { contracts: false, service: 'orders' }).verdict.exitCode).toBe(0);
  });
});

describe('what makes doctor fail a build', () => {
  it('says nothing is wrong when nothing is', () => {
    const report = runDoctor({ db: dbOf(), unresolved: [] }, { strict: true, contracts: false });
    expect(report.verdict).toEqual({ exitCode: 0, reasons: [] });
  });

  it('passes on findings alone, because a report is not a failure', () => {
    // Without --strict this command answers a question. Everything it found is
    // in the report; the exit code is about whether a build should stop.
    const report = runDoctor({ db: dbOf(), unresolved: [row(), row({ file: 'b.ts' })] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(0);
  });

  it('fails when more rows are there than were accepted', () => {
    const report = runDoctor(
      { db: dbOf(), unresolved: [row(), row({ file: 'b.ts' })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row()]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(1);
    expect(report.verdict.reasons.join(' ')).toMatch(/unresolved|grew|baseline/i);
  });

  it('passes when the same rows are there, wherever their lines have moved to', () => {
    const report = runDoctor(
      { db: dbOf(), unresolved: [row({ line: 400 })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row({ line: 12 })]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(0);
  });

  it('leaves a missing baseline to the command, and reports rather than deciding', () => {
    // The report says what it found; whether that stops a build is the
    // command's call, and it is the one that turns this into exit 2. Asserted
    // here so the split stays deliberate rather than becoming an oversight.
    const report = runDoctor(
      { db: dbOf(), unresolved: [row()] },
      {
        strict: true,
        contracts: false,
        baseline: { status: 'missing', note: 'no baseline has been accepted' },
        baselinePath: '/x',
      },
    );
    expect(report.baseline.status).toBe('missing');
    expect(report.verdict.exitCode).toBe(0);
  });

  it('does not grow on an informational row, however many places it stands for', () => {
    // Nothing anybody writes in the repository removes one, so failing on it
    // would fail a build that cannot be fixed.
    const report = runDoctor(
      { db: dbOf(), unresolved: [row(), row({ level: 'info', sites: 333, file: 'x.ts' })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row()]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(0);
  });
});
