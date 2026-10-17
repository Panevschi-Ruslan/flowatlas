import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { causeOfRow, kindOfRow, ROW_KINDS, SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reasonCatalogOf } from './resources.js';
import { createFlowatlasServer } from './server.js';
import { edge, entry, node } from './test-graph.js';

/** The resources (P96): the reason catalogue, the services, and one service read whole. */
const FIXED = '2026-01-01T00:00:00.000Z';
const CALL = 'http_out:gateway#src/orders.client.ts:12:5';
const ROUTE = 'entry:orders:http:POST:/orders';

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
  services: [
    { name: 'gateway', repo: './gateway', type: 'nestjs', extractor: null },
    { name: 'orders', repo: './orders', type: 'nestjs', extractor: null },
  ],
  nodes: [
    node(CALL, { repo: 'gateway', type: 'http_out', label: 'POST /orders' }),
    entry(ROUTE, { label: 'POST /orders', meta: { method: 'POST', path: '/orders' } }),
  ],
  edges: [edge(CALL, ROUTE, { type: 'http_calls' })],
  types: {},
  unresolved: [{ service: 'orders', file: 'src/basket.ts', line: 7, reason: 'query-in-loop', level: 'info', message: 'a lookup per basket line' }],
};

const CATALOG = [
  { reason: 'call-dynamic-receiver', hint: 'The receiver has no single class type.' },
  { reason: 'query-in-loop', hint: 'A query runs once per item.' },
];

let client: Client;
let bare: Client;

const connect = async (options: Parameters<typeof createFlowatlasServer>[0]): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer(options).connect(serverSide);
  const connected = new Client({ name: 'test', version: '0' });
  await connected.connect(clientSide);
  return connected;
};

const read = async (on: Client, uri: string): Promise<any> => JSON.parse(((await on.readResource({ uri })).contents[0] as { text: string }).text);

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-p96-resources-'));
  const dbPath = join(directory, 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  client = await connect({ dbPath, reasonCatalog: CATALOG });
  bare = await connect({ dbPath: join(directory, 'missing', 'graph.db') });
});

afterAll(async () => {
  await client.close();
  await bare.close();
});

describe('the resources (P96)', () => {
  it('list the catalogue, the services, and one resource per service', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((item) => item.uri)).toEqual([
      'flowatlas://reasons',
      'flowatlas://services',
      'flowatlas://services/gateway',
      'flowatlas://services/orders',
    ]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((item) => item.uriTemplate)).toEqual(['flowatlas://services/{name}']);
  });

  it('read the catalogue the CLI handed in, each reason with its kind and cause', async () => {
    const catalogue = await read(client, 'flowatlas://reasons');
    expect(catalogue.source).toBe('doctor');
    expect(catalogue.reasons).toEqual([
      { reason: 'call-dynamic-receiver', kind: 'gap', cause: 'call-dynamic-receiver', hint: 'The receiver has no single class type.' },
      { reason: 'query-in-loop', kind: 'finding', cause: 'query-in-loop', hint: 'A query runs once per item.' },
    ]);
  });

  it('fall back on every reason core classifies, with the cause sentences, when no catalogue was handed in', () => {
    const fallback = reasonCatalogOf();
    expect(fallback.source).toBe('causes');
    expect(fallback.reasons.map((entry) => entry.reason)).toEqual([...ROW_KINDS.keys()].sort());
    const token = fallback.reasons.find((entry) => entry.reason === 'call-through-token');
    expect(token).toMatchObject({ cause: causeOfRow({ reason: 'call-through-token' }).cause, kind: kindOfRow({ reason: 'call-through-token' }) });
    expect(token?.hint).toMatch(/token/);
  });

  it('read one service: its summary, its crossings both ways, its top findings', async () => {
    const orders = await read(client, 'flowatlas://services/orders');
    expect(orders.service).toBe('orders');
    expect(orders.summary.services).toEqual([expect.objectContaining({ service: 'orders', entries: 1 })]);
    expect(orders.crossings.into).toEqual([expect.objectContaining({ from: CALL, to: ROUTE, type: 'http_calls' })]);
    expect(orders.crossings.out).toEqual([]);
    expect(orders.findings).toMatchObject({ total: 1, top: [{ kind: 'n-plus-one', rank: 1 }] });
    expect((await read(client, 'flowatlas://services')).services.map((item: { name: string }) => item.name)).toEqual(['gateway', 'orders']);
  });

  it('refuse a service the graph does not hold, naming the nearest', async () => {
    await expect(client.readResource({ uri: 'flowatlas://services/order' })).rejects.toThrow(/no service named "order"; nearest: orders/);
  });

  it('answer with the tools’ own sentence when there is no database, and list no services', async () => {
    await expect(bare.readResource({ uri: 'flowatlas://services' })).rejects.toThrow(/graph\.db not found at .*; run flowatlas build/);
    expect((await bare.listResources()).resources.map((item) => item.uri)).toEqual(['flowatlas://reasons', 'flowatlas://services']);
    // The catalogue needs no database.
    expect((await read(bare, 'flowatlas://reasons')).source).toBe('causes');
  });
});
