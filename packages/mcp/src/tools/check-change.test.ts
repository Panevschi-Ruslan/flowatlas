import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { DIFF_FORMAT_VERSION, writeGraphDb, type DiffReport, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer, type ServerOptions } from '../server.js';
import { edge, entry, node } from '../test-graph.js';
import { checkChangeAnswer, type ChangeCheck, type ChangeCheckInput } from './changes.js';

/**
 * `check_change` (P387): the working tree against the built graph, worked out
 * by the command line and handed back as `diff`'s document; the server says
 * the verdict, what it rests on and what was not checked, and lists the tool
 * only when it was handed the checker.
 */

const ROUTE = 'entry:catalog:http:PATCH:/items/:param/archive';
const CALL = 'http_out:shop#src/catalog.client.ts:25:26';
const SHOP_ROUTE = 'entry:shop:http:DELETE:/shop/items/:param';

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: '2026-01-01T00:00:00.000Z',
  services: [
    { name: 'catalog', type: 'nestjs', repo: './catalog' },
    { name: 'shop', type: 'nestjs', repo: './shop' },
  ],
  nodes: [entry(ROUTE, { repo: 'catalog', label: 'PATCH /items/:param/archive' }), node(CALL, { type: 'http_out', repo: 'shop' }), entry(SHOP_ROUTE, { repo: 'shop' })],
  edges: [edge(CALL, ROUTE, { type: 'http_calls' })],
  types: {},
  unresolved: [],
} as never;

const report: LinkReport = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: '2026-01-01T00:00:00.000Z',
  configHash: 'test',
  services: [],
  httpOut: { total: 0, linked: 0, byMarker: 0, unknownEnv: 0, noRoute: 0, ambiguous: 0, external: 0, dynamic: 0 },
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  channels: { total: 0, linked: 0, noConsumers: [], noProducers: [] },
  routes: { total: 0, called: 0, uncalled: [], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
};

const diff: DiffReport = {
  diffFormatVersion: DIFF_FORMAT_VERSION,
  schemaVersion: SCHEMA_VERSION,
  generatedAt: '2026-01-01T00:00:00.000Z',
  base: { ref: 'built graph', services: {} },
  head: { ref: null, services: {} },
  nodes: { added: ['entry:catalog:http:PATCH:/items/:param/retire'], removed: [ROUTE], changed: [], moved: [] },
  edges: { added: [], removed: [{ from: CALL, to: ROUTE, type: 'http_calls' }], changed: [] },
  types: { added: [], removed: [], changed: [] },
  unresolved: { added: [], removed: [] },
  joins: { lost: [{ kind: 'target-gone', caller: CALL, target: ROUTE, now: 'target-route-not-found', service: 'shop', targetService: 'catalog', targetRemoved: true }] },
  flows: [],
  counts: {} as never,
  impact: [
    {
      node: ROUTE,
      service: 'catalog',
      label: 'PATCH /items/:param/archive',
      side: 'base',
      entries: [{ id: SHOP_ROUTE, service: 'shop', kind: 'http', type: 'entry', label: 'DELETE /shop/items/:param', file: null, line: null, depth: 2, confidence: 'static' }],
      counts: {},
      truncated: 0,
      services: ['catalog', 'shop'],
      servicesWithoutEntry: [],
      reached: 2,
      partial: false,
    },
  ],
  contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
  rules: { new: [], fixed: [], existing: [], excused: [] },
  spec: null,
  warnings: [],
  timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
} as never;

const check: ChangeCheck = { report: diff, read: ['catalog'], unchecked: [], ms: 1234 };

const clients: Client[] = [];

const connect = async (options: ServerOptions): Promise<Client> => {
  const directory = mkdtempSync(join(tmpdir(), 'flowatlas-p387-'));
  const dbPath = join(directory, 'graph.db');
  writeGraphDb(graph, report, dbPath);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath, toolsPollMs: 0, ...options }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  clients.push(client);
  return client;
};

const call = async (client: Client, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name: 'check_change', arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

afterAll(async () => {
  for (const client of clients) await client.close();
});

describe('check_change', () => {
  it('answers the verdict first, the lost join and the ways in it reaches, complete when nothing was left out', () => {
    const answer = checkChangeAnswer(check, { maxNodes: 10 }) as Record<string, any>;
    expect(Object.keys(answer).slice(0, 5)).toEqual(['verdict', 'because', 'compared', 'read', 'ms']);
    expect(answer.verdict).toBe('unsafe');
    expect(answer.because[0]).toMatch(/1 call lost its target/);
    expect(answer.compared).toBe('working tree against built graph');
    expect(answer.vanishedTargets).toEqual([{ caller: CALL, target: ROUTE, now: 'target-route-not-found' }]);
    expect(answer.retest.map((row: { id: string }) => row.id)).toEqual([SHOP_ROUTE]);
    expect(answer.complete).toBe(true);
    expect(answer.generatedAt).toBeUndefined();
  });

  it('says what it could not check, and is then not complete', () => {
    const answer = checkChangeAnswer({ ...check, unchecked: ['shop: the build wrote no stamps for its files, so it was read whole'] }, { maxNodes: 10 }) as Record<string, any>;
    expect(answer.complete).toBe(false);
    expect(answer.left).toEqual(['unchecked: shop: the build wrote no stamps for its files, so it was read whole']);
  });

  it('is listed only when the server was handed the checker and a configuration, and calls it with the bound asked', async () => {
    const asked: ChangeCheckInput[] = [];
    const without = await connect({ allTools: false });
    expect((await without.listTools()).tools.map((tool) => tool.name)).not.toContain('check_change');
    const withChecker = await connect({
      allTools: true,
      changeChecker: async (input) => {
        asked.push(input);
        return check;
      },
    });
    const answer = await call(withChecker, { base: 'main', services: ['catalog'], timeoutSeconds: 30 });
    expect(asked).toEqual([{ base: 'main', services: ['catalog'], timeoutMs: 30_000 }]);
    expect(answer.verdict).toBe('unsafe');
    expect(answer.next[0]).toBe(`get_flow({entry: ${JSON.stringify(SHOP_ROUTE)}})`);
    // A later page reads the same check rather than building again.
    await call(withChecker, { base: 'main', services: ['catalog'], maxNodes: 1, offset: 1 });
    expect(asked).toHaveLength(1);
  });

  it('hands on the checker’s error, and says to start the server under flowatlas mcp without one', async () => {
    const failing = await connect({ allTools: true, changeChecker: async () => ({ error: 'check_change stopped after 10s', unchecked: ['everything'] }) });
    expect(await call(failing)).toEqual({ error: 'check_change stopped after 10s', unchecked: ['everything'] });
    const bare = await connect({ allTools: true });
    expect((await call(bare)).error).toMatch(/flowatlas mcp with --config, or flowatlas check-change/);
  });
});
