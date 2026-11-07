import { join, resolve } from 'node:path';
import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { createFlowatlasServer, DbHandle, OVERVIEW_URI } from '@flowatlas/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { docsIn } from '../commands/docs.js';
import { REPORT_FILE, runReport, sectionsOf } from '../commands/report.js';
import { sharedStoreRows } from '../doctor/shared-store.js';
import { CliError } from '../exit.js';
import type { QueryIo } from '../query/answer.js';
import { buildTestProject, type TestProject } from '../test-graph.js';
import { overviewFingerprint, overviewOf, type Overview } from './overview.js';
import { renderOverview } from './render.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');

const quiet = (): QueryIo & { stdout: string } => {
  const io = { stdout: '', out: (text: string) => void (io.stdout += text), err: () => {} };
  return io;
};

/**
 * The test project, and the same with a table its gateway writes as well as its orders service.
 * Written once and closed after the file: writing one again while a test's handle is open
 * fails on Windows, where a file held open cannot be removed.
 */
let built: { plain: TestProject; both: TestProject } | undefined;
afterAll(() => {
  built?.plain.db.close();
  built?.both.db.close();
});
const shared = (): { plain: TestProject; both: TestProject } => {
  if (built !== undefined) return built;
  const node = (id: string, over: Partial<GraphNode>): GraphNode => ({ id, type: 'db_query', label: 'write Order', ...over }) as GraphNode;
  const edge = (from: string, to: string): GraphEdge => ({ from, to, type: 'queries', confidence: 'static' }) as GraphEdge;
  const nodes = [
    node('table:orders#Order', { type: 'table', label: 'Order', repo: 'orders' }),
    node('db_query:orders#src/orders/orders.repo.ts:9:2', { repo: 'orders', file: 'src/orders/orders.repo.ts', line: 9, meta: { op: 'write' } }),
    node('db_query:gateway#src/admin/fix.ts:3:2', { repo: 'gateway', file: 'src/admin/fix.ts', line: 3, meta: { op: 'write' } }),
  ];
  built = {
    plain: buildTestProject('overview-plain', { nodes: nodes.slice(0, 2), edges: [edge(nodes[1]!.id, nodes[0]!.id)] }),
    both: buildTestProject('overview-shared', { nodes, edges: [edge(nodes[1]!.id, nodes[0]!.id), edge(nodes[2]!.id, nodes[0]!.id)] }),
  };
  return built;
};

describe('the page a person reads first (P228)', () => {
  it('says the services, what crosses between them, what was not read and what to ask, on the demo project', () => {
    const io = quiet();
    const run = runReport({ config: CONFIG }, io);
    expect(run.overview.services.map((service) => `${service.name} ${service.role}`)).toEqual(['gateway api', 'orders api', 'billing api', 'web browser']);
    expect(run.overview.crossings).toContainEqual({ from: 'orders', to: 'billing', requests: 0, messages: 1, stores: 0, guessed: 0 });
    expect(run.overview.crossings.find((crossing) => crossing.from === 'web')).toMatchObject({ to: 'gateway', guessed: 1 });
    expect(run.overview.secondLook.filter((item) => item.kind === 'single-thread').map((item) => item.says.split(' are joined')[0])).toEqual([
      'billing and gateway',
      'gateway and orders',
    ]);
    expect(run.overview.notRead.sites).toBe(9);
    for (const heading of ['## Services', '## What crosses between them', '```mermaid', '## What most of it depends on', '## Worth a second look', '## What was not read', '## Checks', '## At run time', '## Questions to ask next']) {
      expect(io.stdout, heading).toContain(heading);
    }
    expect(io.stdout).toContain('  s_orders -->|1 message| s_billing');
    // Every question is a command that names an id the graph holds.
    expect(run.overview.questions.at(-1)?.command).toBe('flowatlas diff origin/main');
    expect(run.overview.questions[0]?.command).toMatch(/^flowatlas impact "billing#/);
  });

  it('writes only the sections asked for, as JSON with its fingerprint, or into ARCHITECTURE.md in a directory', () => {
    const io = quiet();
    runReport({ config: CONFIG, sections: 'crossings', format: 'json' }, io);
    expect(JSON.parse(io.stdout)).toMatchObject({ overviewFormatVersion: 1, fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(sectionsOf('crossings,questions')).toEqual(['crossings', 'questions']);
    expect(() => sectionsOf('pictures')).toThrow(CliError);
    expect(REPORT_FILE).toBe('ARCHITECTURE.md');
  });

  it('names a store two services write, as a second look and as a note doctor lists, with the rule that would forbid it', () => {
    const { plain, both } = shared();
    const handle = new DbHandle({ dbPath: both.dbPath });
    const overview = overviewOf(both.db, handle);
    handle.close();
    expect(overview.secondLook.find((item) => item.kind === 'shared-store')).toEqual({
      kind: 'shared-store',
      says: 'Order is written by gateway and orders: a boundary two services share',
      at: ['gateway/src/admin/fix.ts:3', 'orders/src/orders/orders.repo.ts:9'],
    });
    const rows = sharedStoreRows(both.db);
    expect(rows.map((row) => row.message)).toEqual(['gateway writes Order, which orders writes too', 'orders writes Order, which gateway writes too']);
    expect(rows[0]).toMatchObject({ reason: 'store-shared', level: 'info' });
    expect(rows[0]?.hint).toContain('"only": { "from": { "service": "gateway" }, "to": { "table": "Order" }, "op": "write" }');
    expect(sharedStoreRows(plain.db)).toEqual([]);
    // A second writer is a change of shape; the fingerprint says so.
    expect(overviewFingerprint(overviewOf(plain.db, undefined, { structureOnly: true }))).not.toBe(overviewFingerprint(overviewOf(both.db, undefined, { structureOnly: true })));
  });

  it('keeps its fingerprint when only a count moves, and changes it when what crosses changes', () => {
    const { db } = buildTestProject('overview-fingerprint');
    const base = overviewOf(db, undefined, { structureOnly: true });
    db.close();
    const more: Overview = { ...base, crossings: base.crossings.map((crossing) => ({ ...crossing, requests: crossing.requests === 0 ? 0 : crossing.requests + 3 })) };
    expect(overviewFingerprint(more)).toBe(overviewFingerprint(base));
    const another: Overview = { ...base, crossings: [...base.crossings, { from: 'billing', to: 'gateway', requests: 1, messages: 0, stores: 0, guessed: 0 }] };
    expect(overviewFingerprint(another)).not.toBe(overviewFingerprint(base));
  });
});

describe('an overview a team commits (P228)', () => {
  const page = '# Architecture\n\n<!-- flowatlas:overview sections="services,crossings" -->\n<!-- /flowatlas:overview -->\n';

  it('is written by docs --write, then reads as ok, and a structural change makes it changed', () => {
    const { plain, both } = shared();
    const draw = () => '### Services\n\ndrawn\n';
    const written = docsIn(plain.db, 'docs/a.md', page, { write: true, overview: draw });
    expect(written.text).toMatch(/<!-- flowatlas:overview sections="services,crossings" -->\n### Services\n\ndrawn\n<!-- \/flowatlas:overview fingerprint="[0-9a-f]{8}" -->/);
    expect(docsIn(plain.db, 'docs/a.md', written.text).results[0]?.check.state).toBe('ok');
    const moved = docsIn(both.db, 'docs/a.md', written.text).results[0]?.check;
    expect(moved?.state).toBe('changed');
    expect(moved?.why).toContain('a store two services write');
  });

  it('refuses a section there is none of', () => {
    const { plain } = shared();
    const read = docsIn(plain.db, 'docs/a.md', page.replace('services,crossings', 'pictures'));
    expect(read.results).toEqual([]);
    expect(read.problems[0]?.message).toContain('unknown overview section "pictures"');
  });

  it('is what the graph server hands out as flowatlas://overview', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createFlowatlasServer({ configPath: CONFIG, toolsPollMs: 0, overview: (db, at) => renderOverview(overviewOf(db, at)) }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    try {
      const read = await client.readResource({ uri: OVERVIEW_URI });
      const io = quiet();
      runReport({ config: CONFIG }, io);
      expect((read.contents[0] as { text: string }).text).toBe(io.stdout);
    } finally {
      await client.close();
    }
  });
});
