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

const MAP = 'web#src/map.component.ts:StarMapComponent';
const ARCHIVE = 'web#src/archive.component.ts:ArchiveComponent';
const MAP_SCREEN = 'entry:web:screen:/star-map';
const ARCHIVE_SCREEN = 'entry:web:screen:/archive';
const LINK = 'ui_action:web#src/sidebar.html:3:8';

const graph: ProjectGraph = {
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [{ name: 'web', repo: './web', type: 'angular', extractor: null }],
  nodes: [
    entry(MAP_SCREEN, { kind: 'screen', label: '/star-map', repo: 'web', meta: { path: '/star-map', screens: ['StarMapComponent'] } }),
    entry(ARCHIVE_SCREEN, { kind: 'screen', label: '/archive', repo: 'web', meta: { path: '/archive', screens: ['ArchiveComponent'] } }),
    node(MAP, { type: 'ui_component', label: 'StarMapComponent', repo: 'web' }),
    node(ARCHIVE, { type: 'ui_component', label: 'ArchiveComponent', repo: 'web' }),
    node(LINK, { type: 'ui_action', kind: 'route', label: 'routerLink="item.route"', repo: 'web' }),
  ],
  edges: [
    edge(MAP_SCREEN, MAP, { type: 'handles' }),
    edge(ARCHIVE_SCREEN, ARCHIVE, { type: 'handles' }),
    edge(LINK, MAP, { type: 'triggers', meta: { navigates: '/star-map', listed: true } }),
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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'flowatlas-p363-')), 'graph.db');
  writeGraphDb(graph, report(), dbPath);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath, allTools: true }).connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('a screen the router registers is a way in (P363)', () => {
  it('answers who reaches a routed component with its screen, linked or not', async () => {
    const archive = await call('who_calls', { symbol: 'ArchiveComponent' });
    expect(archive.callers.map((caller: { node: { id: string } }) => caller.node.id)).toEqual([ARCHIVE_SCREEN]);
    expect(archive.topOfChain).toBeUndefined();
    const map = await call('who_calls', { symbol: 'StarMapComponent' });
    expect(map.callers.map((caller: { node: { id: string } }) => caller.node.id).sort()).toEqual([MAP_SCREEN, LINK].sort());
  });

  it('judges a routed component alive and says whether a link to it was read', async () => {
    expect(await call('dead', { id: ARCHIVE })).toMatchObject({ verdict: 'alive', reason: 'routed at /archive; no link to it was read' });
    expect(await call('dead', { id: MAP })).toMatchObject({ verdict: 'alive', reason: 'routed at /star-map; 1 link read lands on it' });
  });

  it('lists no screen as a route nobody calls, and says screens are triggered from outside', async () => {
    const listed = await call('dead', {});
    expect(listed.rows).toEqual([]);
    expect(listed.excludedEntryKinds).toContain('screen');
  });

  it('finds a screen among the routes by its address and by the component it shows', async () => {
    const byPath = await call('search', { query: 'star-map', kinds: ['routes'] });
    expect(byPath.results.routes.map((row: { id: string }) => row.id)).toEqual([MAP_SCREEN]);
    const byComponent = await call('search', { query: 'ArchiveComp', kinds: ['routes'] });
    expect(byComponent.results.routes.map((row: { id: string }) => row.id)).toEqual([ARCHIVE_SCREEN]);
  });

  it('reaches the screen from impact on its component', async () => {
    const answer = await call('impact', { symbol: ARCHIVE });
    expect(answer.entries.map((row: { id: string }) => row.id)).toEqual([ARCHIVE_SCREEN]);
  });
});
