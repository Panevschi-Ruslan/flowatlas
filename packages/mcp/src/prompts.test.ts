import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { DIFF_FORMAT_VERSION, writeGraphDb, type DiffReport, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hintsFor } from './query/next.js';
import { createFlowatlasServer } from './server.js';
import { edge, entry, node } from './test-graph.js';

/**
 * The three prompts (P96) on a project of their own: a gateway that asks
 * `orders` for an order, the route and the method behind it, a channel, and
 * a type the request carries.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
const GATEWAY_ROUTE = 'entry:gateway:http:POST:/orders';
const GATEWAY_HANDLER = 'gateway#src/orders.controller.ts:GatewayController.create';
const CALL = 'http_out:gateway#src/orders.client.ts:12:5';
const ROUTE = 'entry:orders:http:POST:/orders';
const HANDLER = 'orders#src/orders.controller.ts:OrdersController.create';
const SERVICE = 'orders#src/orders.service.ts:OrdersService.place';
const TYPE = 'type:orders#PlaceOrderDto';

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
    entry(GATEWAY_ROUTE, { repo: 'gateway', label: 'POST /orders', meta: { method: 'POST', path: '/orders' } }),
    node(GATEWAY_HANDLER, { repo: 'gateway', label: 'GatewayController.create', file: 'src/orders.controller.ts', line: 8 }),
    node(CALL, { repo: 'gateway', type: 'http_out', label: 'POST /orders', file: 'src/orders.client.ts', line: 12 }),
    entry(ROUTE, { label: 'POST /orders', file: 'src/orders.controller.ts', line: 10, meta: { method: 'POST', path: '/orders' } }),
    node(HANDLER, { label: 'OrdersController.create', file: 'src/orders.controller.ts', line: 11 }),
    node(SERVICE, { label: 'OrdersService.place', file: 'src/orders.service.ts', line: 20 }),
  ],
  edges: [
    edge(GATEWAY_ROUTE, GATEWAY_HANDLER, { type: 'handles' }),
    edge(GATEWAY_HANDLER, CALL),
    edge(CALL, ROUTE, { type: 'http_calls', params: [TYPE] }),
    edge(ROUTE, HANDLER, { type: 'handles' }),
    edge(HANDLER, SERVICE),
  ],
  types: {
    [TYPE]: { name: 'PlaceOrderDto', kind: 'object', declaredIn: 'orders#src/orders.dto.ts', structuralHash: 'h', fields: [] } as never,
  },
  unresolved: [{ service: 'orders', file: 'src/orders.service.ts', line: 22, reason: 'call-dynamic-receiver', level: 'info', symbol: SERVICE }],
};

const diff: DiffReport = {
  diffFormatVersion: DIFF_FORMAT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  generatedAt: FIXED,
  base: { ref: 'main', services: {} },
  head: { ref: null, services: {} },
  nodes: { added: [], removed: [], changed: [], moved: [] },
  edges: { added: [], removed: [], changed: [] },
  types: { added: [], removed: [], changed: [] },
  unresolved: { added: [], removed: [] },
  joins: { lost: [] },
  flows: [],
  counts: {
    base: { nodes: 0, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } },
    head: { nodes: 0, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } },
  },
  impact: [],
  contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
  rules: { new: [], fixed: [], existing: [], excused: [] },
  warnings: [],
  timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
};

let client: Client;
let dbPath: string;

const prompt = async (name: string, args: Record<string, string> = {}): Promise<string> => {
  const answer = await client.getPrompt({ name, arguments: args });
  const content = answer.messages[0]!.content as { type: string; text: string };
  expect(content.type).toBe('text');
  return content.text;
};

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-p96-prompts-'));
  dbPath = join(directory, 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('the prompts (P96)', () => {
  it('are listed, each with the arguments it takes', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((item) => [item.name, (item.arguments ?? []).map((arg) => [arg.name, arg.required ?? false])])).toEqual([
      ['before-rename', [['symbol', true]]],
      ['pr-review', [['base', false]]],
      ['trace-route', [['route', true]]],
    ]);
    for (const item of prompts) expect(item.description?.length ?? 0).toBeGreaterThan(40);
  });

  it('before-rename names the calls `next` would, on the resolved id, and every crossing it is on', async () => {
    const text = await prompt('before-rename', { symbol: 'OrdersController.create' });
    expect(text).toContain(`\`${HANDLER}\``);
    for (const hint of hintsFor({ id: HANDLER, type: 'method' })) expect(text).toContain(`\`${hint}\``);
    // The request into the way in that hands it work crosses from the gateway.
    expect(text).toContain(`\`check_contract({from: ${JSON.stringify(CALL)}, to: ${JSON.stringify(ROUTE)}})\``);
    expect(text).toMatch(/Then say what else must be renamed with it/);
  });

  it('before-rename on a type asks type_usage and checks the crossings that carry it', async () => {
    const text = await prompt('before-rename', { symbol: 'PlaceOrderDto' });
    for (const hint of hintsFor({ id: TYPE, type: 'type' })) expect(text).toContain(`\`${hint}\``);
    expect(text).toContain('type_usage');
  });

  it('before-rename on words that answer to several lists them and asks which', async () => {
    const text = await prompt('before-rename', { symbol: 'POST /orders' });
    expect(text).toMatch(/answers to more than one thing/);
    expect(text).toContain(`\`${GATEWAY_ROUTE}\``);
    expect(text).toContain(`\`${ROUTE}\``);
  });

  it('trace-route names get_flow, check_contract on each crossing, cant_follow where the walk meets a gap, and the text to hand on', async () => {
    const text = await prompt('trace-route', { route: GATEWAY_ROUTE });
    expect(text).toContain(`\`get_flow({entry: ${JSON.stringify(GATEWAY_ROUTE)}})\``);
    expect(text).toContain(`\`check_contract({from: ${JSON.stringify(CALL)}, to: ${JSON.stringify(ROUTE)}})\``);
    expect(text).toContain('`cant_follow({service: "gateway"})`');
    expect(text).toContain(`\`describe_for_prompt({id: ${JSON.stringify(GATEWAY_ROUTE)}})\``);
  });

  it('pr-review says to run flowatlas diff when there is none, or when a build came after it', async () => {
    expect(await prompt('pr-review', { base: 'main' })).toMatch(/no `diff.json`[\s\S]*Run `flowatlas diff main`/);
    const file = join(dbPath, '..', 'diff.json');
    writeFileSync(file, JSON.stringify(diff));
    const long = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, long, long);
    expect(await prompt('pr-review')).toMatch(/written before the database was built again[\s\S]*flowatlas diff <base-ref>/);
  });

  it('pr-review asks for the verdict on a diff that is current, and names another base when asked for one', async () => {
    writeFileSync(join(dbPath, '..', 'diff.json'), JSON.stringify(diff));
    const text = await prompt('pr-review');
    expect(text).toContain('`what_changed({verdict: true})`');
    expect(text).toMatch(/compared main with the working tree/);
    expect(await prompt('pr-review', { base: 'release' })).toMatch(/compared against `main`, not `release`[\s\S]*flowatlas diff release/);
  });
});
