import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAccepted, SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { DIFF_FORMAT_VERSION, writeGraphDb, type DiffReport, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';

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
  totals: { nodes: 0, edges: 0, types: 0, unresolved: 0 },
});

const ROUTE = 'orders:entry:POST /orders';
const HANDLER = 'orders:OrdersController.create';
const SERVICE = 'orders:OrdersService.place';
const CHANNEL = 'channel:order.placed';
const TABLE = 'table:orders';

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'orders', repo: './orders', type: 'nestjs', extractor: null }],
  nodes: [
    entry(ROUTE, {
      label: 'POST /orders',
      meta: { fails: [{ status: 422, exception: 'CouponRejectedError', at: SERVICE, source: 'throw' }] },
    }),
    node(HANDLER, { label: 'OrdersController.create' }),
    node(SERVICE, { label: 'OrdersService.place' }),
    node('orders:OrdersService', { type: 'provider', label: 'OrdersService' }),
    node(CHANNEL, { type: 'channel', label: 'order.placed' }),
    node(TABLE, { type: 'table', label: 'orders' }),
  ],
  edges: [edge(ROUTE, HANDLER, { type: 'handles' }), edge(HANDLER, SERVICE), edge(SERVICE, CHANNEL, { type: 'emits' })],
  types: {
    'type:orders#PlaceOrderDto': {
      name: 'PlaceOrderDto',
      kind: 'object',
      declaredIn: 'orders#src/orders.dto.ts',
      structuralHash: 'h',
      fields: [],
    } as never,
  },
  unresolved: [
    { service: 'orders', file: 'src/orders.service.ts', line: 12, reason: 'channel-dynamic', message: 'order channel built at run time' },
    { service: 'orders', file: 'src/orders.repo.ts', line: 30, reason: 'db-receiver-name-only', message: 'orders table read by name only' },
  ] as never,
};

const diff: DiffReport = {
  diffFormatVersion: DIFF_FORMAT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  generatedAt: FIXED,
  base: { ref: 'main', services: {} },
  head: { ref: null, services: {} },
  nodes: {
    added: [TABLE],
    removed: ['orders:OrdersService.legacy'],
    changed: [{ id: SERVICE, service: 'orders', label: 'OrdersService.place', fields: ['meta.returns'] }],
    moved: [],
  },
  edges: { added: [{ from: SERVICE, to: CHANNEL, type: 'emits' }], removed: [], changed: [] },
  types: { added: [], removed: [], changed: [] },
  counts: {
    base: { nodes: 5, edges: 2, types: 1, unresolved: { rows: 2, sites: 2 } },
    head: { nodes: 6, edges: 3, types: 1, unresolved: { rows: 2, sites: 2 } },
  } as never,
  impact: [
    {
      node: SERVICE,
      service: 'orders',
      label: 'OrdersService.place',
      side: 'head',
      entries: [
        { id: ROUTE, service: 'orders', kind: 'http', type: 'entry', label: 'POST /orders', file: null, line: null, depth: 2, confidence: 'static' },
      ],
      counts: { 'orders:http': 1 },
      truncated: 0,
      services: ['orders'],
      servicesWithoutEntry: [],
      reached: 2,
      partial: false,
    },
  ],
  contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
  warnings: [],
  timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
};

let client: Client;
let dbPath: string;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-p72-'));
  dbPath = join(directory, 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  writeFileSync(
    join(directory, 'observed.json'),
    JSON.stringify({
      observedFormatVersion: 1,
      spans: 9,
      joins: {
        [`${ROUTE} -handles-> ${HANDLER}`]: { count: 7, lastSeen: FIXED },
        [`${HANDLER} -calls-> ${SERVICE}`]: { count: 5, lastSeen: FIXED },
      },
      entries: { [ROUTE]: { hits: 7, lastSeen: FIXED } },
      symbols: { [SERVICE]: { hits: 5 } },
      channels: {},
      unmatched: [],
    }),
  );
  saveAccepted(dbPath, [{ reason: 'db-receiver-name-only', note: 'known; read by name', acceptedAt: FIXED }]);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('search', () => {
  it('groups what a query finds by kind, each row with the id the next tool takes', async () => {
    const found = await call('search', { query: 'order' });
    expect(Object.keys(found.results).sort()).toEqual(['channels', 'classes', 'gaps', 'routes', 'tables', 'types']);
    expect(found.results.routes[0].id).toBe(ROUTE);
    expect(found.results.types[0]).toMatchObject({ id: 'type:orders#PlaceOrderDto', type: 'type', service: 'orders' });
    expect(found.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
  });

  it('marks accepted gaps and lists the new ones first', async () => {
    const found = await call('search', { query: 'orders', kinds: ['gaps'] });
    expect(found.results.gaps.map((gap: { id: string }) => gap.id)).toEqual([
      'gap:orders|src/orders.service.ts|channel-dynamic',
      'gap:orders|src/orders.repo.ts|db-receiver-name-only',
    ]);
    expect(found.results.gaps[0].accepted).toBeUndefined();
    expect(found.results.gaps[1]).toMatchObject({ accepted: true, note: 'known; read by name' });
  });

  it('finds the ways in that can fail with an exception, by its name or status', async () => {
    const found = await call('search', { query: 'coupon' });
    expect(Object.keys(found.results)).toEqual(['fails']);
    expect(found.results.fails).toEqual([
      { id: ROUTE, type: 'entry', label: 'POST /orders', exception: 'CouponRejectedError', status: 422, service: 'orders' },
    ]);
    expect(found.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
    expect((await call('search', { query: '422', kinds: ['fails'] })).counts).toEqual({ fails: 1 });
  });

  it('says when nothing matches', async () => {
    expect((await call('search', { query: 'zzz-nothing' })).error).toMatch(/nothing matches/);
  });
});

describe('observed counts', () => {
  it('sit on get_flow rows real traffic went through, and nowhere else', async () => {
    const flow = await call('get_flow', { entry: ROUTE });
    expect(flow.root.observed).toBe(7);
    const handler = flow.root.children[0];
    expect(handler.observed).toBe(7);
    expect(handler.children[0].observed).toBe(5);
    expect(handler.children[0].children[0].observed).toBeUndefined();
  });

  it('sit on who_calls rows, read along the edge the other way', async () => {
    const callers = await call('who_calls', { symbol: SERVICE });
    expect(callers.target.observed).toBe(5);
    expect(callers.callers[0]).toMatchObject({ node: { id: HANDLER }, observed: 5 });
    expect(callers.callers[0].children[0]).toMatchObject({ node: { id: ROUTE }, observed: 7 });
  });
});

describe('what_changed', () => {
  it('says to run diff when there is no diff.json', async () => {
    expect((await call('what_changed')).error).toMatch(/flowatlas diff/);
  });

  it('reads the last diff back, cut to what a session asks next', async () => {
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
    const changes = await call('what_changed');
    expect(changes.base).toBe('main');
    expect(changes.counts.nodes).toEqual({ added: 1, removed: 1, changed: 1, moved: 0 });
    expect(changes.entries).toEqual([
      expect.objectContaining({ id: ROUTE, reaches: SERVICE, confidence: 'static' }),
    ]);
    expect(changes.next[0]).toBe(`get_flow({entry: ${JSON.stringify(ROUTE)}})`);
    expect(changes.next[1]).toBe(`impact({symbol: ${JSON.stringify(SERVICE)}})`);
  });

  it('narrows to a service, and bounds every list', async () => {
    const elsewhere = await call('what_changed', { service: 'billing' });
    expect(elsewhere.entries).toEqual([]);
    expect(elsewhere.nodes.changed).toEqual([]);
    const cut = await call('what_changed', { maxNodes: 1 });
    expect(cut.nodes.added).toHaveLength(1);
  });
});
