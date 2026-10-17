import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { DOCS_FORMAT_VERSION, openGraphDb, writeGraphDb, type DocsIndex, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';
import { checkDocBlock, docSubjectOf, resolveDocTarget } from './docs.js';

/**
 * `docs` on the answers about a node (P120): a page of blocks indexed in
 * `docs.json` beside the database, each checked against the graph when it is
 * asked about, so an agent learns there is a page it must keep true.
 */
const FIXED = '2026-01-01T00:00:00.000Z';
const ROUTE = 'entry:shop:http:POST:/carts';
const HANDLER = 'shop#src/carts.controller.ts:CartsController.create';
const SERVICE = 'shop#src/carts.service.ts:CartsService.add';

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
  nodes: [
    entry(ROUTE, { repo: 'shop', label: 'POST /carts', file: 'src/carts.controller.ts', line: 5, meta: { method: 'POST', path: '/carts' } }),
    node(HANDLER, { repo: 'shop', label: 'CartsController.create', file: 'src/carts.controller.ts', line: 5 }),
    node(SERVICE, { repo: 'shop', label: 'CartsService.add', file: 'src/carts.service.ts', line: 9 }),
    node('channel:cart.created', { type: 'channel', label: 'cart.created', repo: '' }),
  ],
  edges: [edge(ROUTE, HANDLER, { type: 'handles' }), edge(HANDLER, SERVICE)],
  types: {},
  unresolved: [],
};

const dir = mkdtempSync(join(tmpdir(), 'flowatlas-mcp-docs-'));
const dbPath = join(dir, 'with', 'graph.db');
const bareDbPath = join(dir, 'without', 'graph.db');
let client: Client;
let bare: Client;

const connect = async (path: string): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath: path }).connect(serverSide);
  const made = new Client({ name: 'test', version: '0' });
  await made.connect(clientSide);
  return made;
};

const call = async (on: Client, name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await on.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  mkdirSync(join(dir, 'with'), { recursive: true });
  mkdirSync(join(dir, 'without'), { recursive: true });
  writeGraphDb(graph, report(), dbPath);
  writeGraphDb(graph, report(), bareDbPath);
  const db = openGraphDb(dbPath, { readonly: true });
  const route = db.node(ROUTE)!;
  const fingerprint = docSubjectOf(db, { kind: 'flow', options: {}, view: 'steps' }, route).fingerprint;
  db.close();
  const index: DocsIndex = {
    docsFormatVersion: DOCS_FORMAT_VERSION,
    files: ['docs/carts.md'],
    blocks: [
      { file: 'docs/carts.md', line: 3, kind: 'flow', id: 'POST /carts', node: ROUTE, view: 'steps', state: 'ok', fingerprint },
      // Written against an older graph: checked now, it is stale.
      { file: 'docs/carts.md', line: 12, kind: 'flow', id: 'POST /carts', node: ROUTE, view: 'tour', state: 'ok', fingerprint: '00000000' },
      { file: 'docs/carts.md', line: 20, kind: 'ref', id: 'CartsService.add', node: SERVICE, state: 'ok' },
      { file: 'docs/carts.md', line: 25, kind: 'flow', id: 'DELETE /carts', state: 'gone', near: [ROUTE] },
    ],
    problems: [],
  };
  writeFileSync(join(dir, 'with', 'docs.json'), JSON.stringify(index));
  client = await connect(dbPath);
  bare = await connect(bareDbPath);
});

afterAll(async () => {
  await client.close();
  await bare.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('docs on an answer (P120)', () => {
  it('get_flow and describe_for_prompt name the blocks about the way in, each checked now', async () => {
    const expected = [
      { file: 'docs/carts.md', line: 3, kind: 'flow', state: 'ok' },
      { file: 'docs/carts.md', line: 12, kind: 'flow', state: 'changed' },
    ];
    expect((await call(client, 'get_flow', { entry: 'POST /carts' })).docs).toEqual(expected);
    expect((await call(client, 'describe_for_prompt', { id: 'POST /carts' })).docs).toEqual(expected);
  });

  it('impact names the page that mentions the symbol', async () => {
    expect((await call(client, 'impact', { symbol: SERVICE })).docs).toEqual([{ file: 'docs/carts.md', line: 20, kind: 'ref', state: 'ok' }]);
  });

  it('start_here counts the blocks that no longer say what the graph says', async () => {
    expect((await call(client, 'start_here', {})).staleDocs).toBe(2);
    expect((await call(client, 'start_here', { service: 'shop' })).staleDocs).toBe(1);
  });

  it('says nothing about docs where no index was written', async () => {
    expect((await call(bare, 'get_flow', { entry: 'POST /carts' })).docs).toBeUndefined();
    expect((await call(bare, 'start_here', {})).staleDocs).toBeUndefined();
  });
});

describe('resolveDocTarget', () => {
  it('takes a channel without its prefix, and names nothing it cannot single out', () => {
    const db = openGraphDb(dbPath, { readonly: true });
    try {
      expect(resolveDocTarget(db, { kind: 'channel', id: 'cart.created', options: {} })).toMatchObject({ found: 'node', node: { id: 'channel:cart.created' } });
      expect(resolveDocTarget(db, { kind: 'channel', id: 'CartsService.add', options: {} })).toMatchObject({ found: 'gone' });
      expect(resolveDocTarget(db, { kind: 'flow', id: 'POST /carts', options: { service: 'billing' } })).toMatchObject({ found: 'gone' });
      const gone = resolveDocTarget(db, { kind: 'flow', id: 'POST /cart', options: {} });
      expect(gone).toEqual({ found: 'gone', near: [ROUTE] });
      expect(checkDocBlock(db, { kind: 'ref', id: 'CartsService.add', options: {} }).state).toBe('ok');
    } finally {
      db.close();
    }
  });
});
