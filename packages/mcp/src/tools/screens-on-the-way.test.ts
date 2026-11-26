import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import { edge, entry, node } from '../test-graph.js';

/**
 * P406: what a public pilot's all-repositories sessions spent turns on. A
 * route two screens request through the gateway, no router showing either;
 * a service method that writes rows; a route nothing calls, declared with a
 * named parameter.
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
  routes: { total: 1, called: 0, uncalled: ['entry:catalog:http:DELETE:/photos/:param'], duplicated: [] },
  types: { total: 0, sharedPackage: 0 },
  unresolved: [],
  totals: { nodes: 0, edges: 0, types: 0, missed: 0, sites: 0, notes: 0, findings: 0, unresolved: 0 },
});

const ROUTE = 'entry:catalog:http:POST:/photos';
const UNCALLED = 'entry:catalog:http:DELETE:/photos/:param';
const HANDLER = 'catalog#src/photos/photos.controller.ts:PhotosController.create';
const SERVICE_CREATE = 'catalog#src/photos/photos.service.ts:PhotosService.create';
const SERVICE_LIST = 'catalog#src/photos/photos.service.ts:PhotosService.list';
const WRITE = 'db_query:catalog#src/photos/photos.service.ts:20:5';
const READ = 'db_query:catalog#src/photos/photos.service.ts:12:5';
const GATEWAY = 'entry:gateway:http:POST:/api/photos';
const GATEWAY_HANDLER = 'gateway#src/photos/photos.controller.ts:GatewayPhotosController.create';
const CLIENT = 'gateway#src/clients/photos.client.ts:PhotosClient.create';
const OUT = 'http_out:gateway#src/clients/photos.client.ts:18:27';
const WEB_CALL = 'ui_api_call:web#src/photos/photos.api.ts:1:40';
const WEB_FN = 'web#src/photos/photos.api.ts:createPhoto';
const WEB_PANEL = 'web#src/photos/PhotosPanel.tsx:PhotosPanel';
const ADMIN_CALL = 'ui_api_call:admin#src/app/photos/photos-api.service.ts:12:12';
const ADMIN_API = 'admin#src/app/photos/photos-api.service.ts:PhotosApiService.create';
const ADMIN_COMPONENT = 'admin#src/app/photos/photos.component.ts:PhotosComponent';
const ADMIN_CREATE = 'admin#src/app/photos/photos.component.ts:PhotosComponent.create';

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [
    { name: 'catalog', repo: './catalog', type: 'nestjs', extractor: null },
    { name: 'gateway', repo: './gateway', type: 'nestjs', extractor: null },
    { name: 'web', repo: './web', type: 'react', extractor: null },
    { name: 'admin', repo: './admin', type: 'angular', extractor: null },
  ],
  nodes: [
    entry(ROUTE, { kind: 'http', label: 'POST /photos', repo: 'catalog', file: 'src/photos/photos.controller.ts', meta: { method: 'POST', path: '/photos' } }),
    entry(UNCALLED, {
      kind: 'http',
      label: 'DELETE /photos/:param',
      repo: 'catalog',
      file: 'src/photos/photos.controller.ts',
      meta: { method: 'DELETE', path: '/photos/:param', rawPath: '/photos/:id' },
    }),
    node(HANDLER, { type: 'method', label: 'PhotosController.create', repo: 'catalog', file: 'src/photos/photos.controller.ts' }),
    node(SERVICE_CREATE, { type: 'method', label: 'PhotosService.create', repo: 'catalog', file: 'src/photos/photos.service.ts' }),
    node(SERVICE_LIST, { type: 'method', label: 'PhotosService.list', repo: 'catalog', file: 'src/photos/photos.service.ts' }),
    node(WRITE, { type: 'db_query', label: 'write photos', repo: 'catalog', file: 'src/photos/photos.service.ts', meta: { op: 'write', table: 'photos', tables: ['photos'] } }),
    node(READ, { type: 'db_query', label: 'read photos', repo: 'catalog', file: 'src/photos/photos.service.ts', meta: { op: 'read', table: 'photos', tables: ['photos'] } }),
    entry(GATEWAY, { kind: 'http', label: 'POST /api/photos', repo: 'gateway', file: 'src/photos/photos.controller.ts', meta: { method: 'POST', path: '/api/photos' } }),
    node(GATEWAY_HANDLER, { type: 'method', label: 'GatewayPhotosController.create', repo: 'gateway', file: 'src/photos/photos.controller.ts' }),
    node(CLIENT, { type: 'method', label: 'PhotosClient.create', repo: 'gateway', file: 'src/clients/photos.client.ts' }),
    node(OUT, { type: 'http_out', label: 'POST /photos', repo: 'gateway', file: 'src/clients/photos.client.ts' }),
    node(WEB_CALL, { type: 'ui_api_call', label: 'POST /api/photos', repo: 'web', file: 'src/photos/photos.api.ts' }),
    node(WEB_FN, { type: 'function', label: 'createPhoto', repo: 'web', file: 'src/photos/photos.api.ts' }),
    // Named nowhere else in their repositories (`unreferenced`): nothing unread could reach them, so no maybe row.
    node(WEB_PANEL, { type: 'ui_component', label: 'PhotosPanel', repo: 'web', file: 'src/photos/PhotosPanel.tsx', meta: { unreferenced: true } }),
    node(ADMIN_CALL, { type: 'ui_api_call', label: 'POST /api/photos', repo: 'admin', file: 'src/app/photos/photos-api.service.ts' }),
    node(ADMIN_API, { type: 'method', label: 'PhotosApiService.create', repo: 'admin', file: 'src/app/photos/photos-api.service.ts' }),
    node(ADMIN_COMPONENT, { type: 'ui_component', label: 'PhotosComponent', repo: 'admin', file: 'src/app/photos/photos.component.ts', meta: { unreferenced: true } }),
    node(ADMIN_CREATE, { type: 'method', label: 'PhotosComponent.create', repo: 'admin', file: 'src/app/photos/photos.component.ts', meta: { unreferenced: true } }),
  ],
  edges: [
    edge(ROUTE, HANDLER, { type: 'handles' }),
    edge(HANDLER, SERVICE_CREATE, { type: 'calls' }),
    edge(SERVICE_CREATE, WRITE, { type: 'calls' }),
    edge(SERVICE_LIST, READ, { type: 'calls' }),
    edge(GATEWAY, GATEWAY_HANDLER, { type: 'handles' }),
    edge(GATEWAY_HANDLER, CLIENT, { type: 'calls' }),
    edge(CLIENT, OUT, { type: 'calls' }),
    edge(OUT, ROUTE, { type: 'http_calls' }),
    edge(WEB_CALL, GATEWAY, { type: 'hits' }),
    edge(WEB_FN, WEB_CALL, { type: 'calls' }),
    edge(WEB_PANEL, WEB_FN, { type: 'calls' }),
    edge(ADMIN_CALL, GATEWAY, { type: 'hits' }),
    edge(ADMIN_API, ADMIN_CALL, { type: 'calls' }),
    edge(ADMIN_CREATE, ADMIN_API, { type: 'calls' }),
  ],
  types: {},
  unresolved: [],
};

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'flowatlas-p406-')), 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath, allTools: true }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

const SCREENS = { admin: ['src/app/photos/photos.component.ts'], web: ['src/photos/PhotosPanel.tsx'] };

describe('the screens on the way, where no router shows them (P406)', () => {
  it('impact names the component files beside the way in, and says so in settled', async () => {
    const answer = await call('impact', { symbol: ROUTE });
    expect(answer.components).toEqual(SCREENS);
    expect(answer.settled).toBe('1 way in breaks, all listed; 2 component files in admin, web on the way, all listed in components');
  });

  it('who_calls names them too, so "no way in reaches it" is not read as nothing using it', async () => {
    const answer = await call('who_calls', { symbol: GATEWAY });
    expect(answer.components).toEqual(SCREENS);
    expect(answer.settled).toContain('2 component files in admin, web on the way');
  });

  it('says none where the walk meets no component', async () => {
    const answer = await call('impact', { symbol: SERVICE_LIST });
    expect(answer.components).toBeUndefined();
  });
});

describe('a method row says the tables it writes (P406)', () => {
  it('find_symbol says writes on a method that writes rows, and nothing on one that reads', async () => {
    const answer = await call('find_symbol', { query: 'PhotosService', service: 'catalog' });
    const rows = new Map(answer.matches.map((row: { id: string }) => [row.id, row]));
    expect(rows.get(SERVICE_CREATE)).toMatchObject({ writes: ['photos'] });
    expect(rows.get(SERVICE_LIST)).not.toHaveProperty('writes');
  });
});

describe('check_contract takes the method sending a request as its end (P406)', () => {
  it('checks the request the method makes, not "no call from" it', async () => {
    const byMethod = await call('check_contract', { from: CLIENT, to: ROUTE });
    const byRequest = await call('check_contract', { from: OUT, to: ROUTE });
    expect(byMethod.error).toBeUndefined();
    expect(byMethod).toEqual(byRequest);
  });

  it('still says there is no call where the method makes none to that route', async () => {
    const answer = await call('check_contract', { from: SERVICE_LIST, to: ROUTE });
    expect(answer.error).toContain('no call from');
  });
});

describe('a route nothing calls is named as declared (P406)', () => {
  it('a dead row folds the path as written into its label', async () => {
    const answer = await call('dead', { service: 'catalog', kind: 'entries' });
    const row = answer.rows.find((each: { id: string }) => each.id === UNCALLED);
    expect(row).toMatchObject({ label: 'DELETE /photos/:id' });
    expect(row).not.toHaveProperty('rawPath');
  });
});
