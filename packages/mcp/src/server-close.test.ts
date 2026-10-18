import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DbHandle } from './query/db.js';
import { createFlowatlasServer } from './server.js';
import { entry } from './test-graph.js';

/**
 * A server lets go of its database when its client leaves (P199): on Windows
 * a file held open can be neither removed nor replaced, so a build's rename
 * and a test's clean-up both waited on a server nobody was talking to.
 */
const FIXED = '2026-01-01T00:00:00.000Z';

const report = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
  services: [],
  httpOut: { total: 0, linked: 0, byMarker: 0, unknownEnv: 0, noRoute: 0, ambiguous: 0, external: 0, dynamic: 0 },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
});

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'shop', repo: './shop', type: 'nestjs', extractor: null }],
  nodes: [entry('entry:shop:http:GET:/carts', { repo: 'shop', label: 'GET /carts', meta: { method: 'GET', path: '/carts' } })],
  edges: [],
  types: {},
  unresolved: [],
};

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A client of a fresh server over the graph at `dbPath`, having asked it one question. */
const asked = async (server: ReturnType<typeof createFlowatlasServer>): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'close-test', version: '0' });
  await client.connect(clientSide);
  const answer = (await client.callTool({ name: 'list_entries', arguments: {} })) as { content: Array<{ text: string }> };
  expect(answer.content[0]?.text).toContain('GET /carts');
  return client;
};

describe('a server whose client leaves', () => {
  it('closes the database it opened, and opens it again for the next connection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowatlas-close-'));
    dirs.push(dir);
    const dbPath = join(dir, 'graph.db');
    writeGraphDb(graph, report(), dbPath);
    const closed = vi.spyOn(DbHandle.prototype, 'close');
    const server = createFlowatlasServer({ dbPath });

    const first = await asked(server);
    expect(closed).not.toHaveBeenCalled();
    await first.close();
    expect(closed).toHaveBeenCalledTimes(1);

    // Nothing holds the file now, so a build may replace it.
    writeGraphDb(graph, report(), dbPath);
    const second = await asked(server);
    await second.close();
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
