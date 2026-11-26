import {
  NO_SETTINGS,
  SAME_CALL_META,
  SCHEMA_VERSION,
  parseConfig,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type RepoSettings,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges,
  types: {},
  unresolved: [],
});

const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

const BROWSER = 'ui_api_call:shop#app/load.ts:5:9';
const SERVER = 'http_out:shop#app/load.ts:5:9';

/** One call of a full-stack `shop`, read by both halves and paired (P283). */
const pair = (meta: Record<string, unknown>): GraphNode[] =>
  ([
    ['ui_api_call', BROWSER, SERVER],
    ['http_out', SERVER, BROWSER],
  ] as const).map(([type, id, other]) => ({
    id,
    type,
    kind: 'http',
    label: 'GET /api/items',
    repo: 'shop',
    file: 'app/load.ts',
    line: 5,
    meta: { method: 'GET', path: '/api/items', baseUrlEnv: null, [SAME_CALL_META]: other, ...meta },
  }));

/** `shop` and `catalog` both serve `GET /api/items`: the address alone settles nothing between them. */
const routes = (): RepoGraph[] => [graph('catalog', [route('catalog', 'GET', '/api/items')])];

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls')
    .map((edge) => `${edge.from.split(':')[0]} ${edge.to} ${edge.confidence} ${String(edge.meta?.['via'])}`)
    .sort();

describe('one call read by both halves of a full-stack application goes to one target (P292)', () => {
  const config = (shop: Record<string, unknown> = {}) =>
    parseConfig({
      services: [
        { name: 'shop', repo: './shop', type: 'nextjs', ...shop },
        { name: 'catalog', repo: './catalog', type: 'express' },
      ],
    } as Parameters<typeof parseConfig>[0]);

  it("follows the server half's join where the browser half would have joined elsewhere", () => {
    // The server half's method says outright which service it calls; the
    // browser half, reading the relative address, would take its own route.
    const method: GraphNode = {
      id: 'function:shop#app/load.ts:loader',
      type: 'function',
      label: 'loader',
      repo: 'shop',
      file: 'app/load.ts',
      line: 3,
      meta: { markers: [{ name: 'CallsService', args: ['catalog', 'GET /api/items'] }] },
    };
    const result = linkGraphs(
      [...routes(), graph('shop', [route('shop', 'GET', '/api/items'), method, ...pair({})], [{ from: method.id, to: SERVER, type: 'calls', confidence: 'static' }])],
      config(),
      { builtAt: FIXED },
    );
    expect(joins(result)).toEqual([
      'http_out entry:catalog:http:GET:/api/items marker marker',
      'ui_api_call entry:catalog:http:GET:/api/items marker same-call',
    ]);
    const browserEdge = result.project.edges.find((edge) => edge.from === BROWSER);
    expect(browserEdge?.meta).toMatchObject({ sameCallVia: 'marker', targetService: 'catalog' });
  });

  it("moves the server half to the browser half's join where the configuration wrote it for the browser", () => {
    const result = linkGraphs(
      [...routes(), graph('shop', [route('shop', 'GET', '/api/items'), ...pair({ baseUrlEnv: 'API_URL' })])],
      config({ baseUrlEnv: ['API_URL'], apiTarget: { API_URL: 'catalog' } }),
      { builtAt: FIXED },
    );
    expect(joins(result)).toEqual([
      'http_out entry:catalog:http:GET:/api/items static sameCall',
      'ui_api_call entry:catalog:http:GET:/api/items static api-target',
    ]);
    expect(result.project.nodes.find((node) => node.id === SERVER)?.meta?.['targetService']).toBe('catalog');
  });

  it('leaves both halves alone where they agree', () => {
    const result = linkGraphs([...routes(), graph('shop', [...pair({ baseUrlEnv: 'CATALOG_URL' })])], config(), { builtAt: FIXED });
    expect(joins(result)).toEqual([
      'http_out entry:catalog:http:GET:/api/items heuristic baseUrlValue',
      'ui_api_call entry:catalog:http:GET:/api/items heuristic base-url-value',
    ]);
  });
});

describe("a setting's value at a port only the code says a service listens on (P292)", () => {
  const config = parseConfig({
    services: [
      { name: 'orders', repo: './orders', type: 'express' },
      { name: 'billing', repo: './billing', type: 'express' },
      { name: 'jobs', repo: './jobs', type: 'express' },
    ],
  } as Parameters<typeof parseConfig>[0]);
  const server = (repo: string, port: number): RepoGraph =>
    graph(repo, [
      { id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: [{ port, file: 'src/main.ts', line: 7 }] } },
      route(repo, 'GET', '/items'),
    ]);
  const caller = graph('jobs', [
    {
      id: 'http_out:jobs#src/sync.ts:4:9',
      type: 'http_out',
      kind: 'http',
      label: 'GET /items',
      repo: 'jobs',
      file: 'src/sync.ts',
      line: 4,
      meta: { method: 'GET', path: '/items', baseUrlEnv: 'UPSTREAM_URL' },
    },
  ]);
  const settings = (value: string): Record<string, RepoSettings> => ({
    jobs: { ...NO_SETTINGS, values: { UPSTREAM_URL: [{ value, file: '.env.example' }] } },
  });

  it('places the request at the service whose code listens on the port, as a guess from the file', () => {
    const result = linkGraphs([server('orders', 4001), server('billing', 4002), caller], config, { builtAt: FIXED, settings: settings(`http:${SLASHES}localhost:4002`) });
    expect(joins(result)).toEqual(['http_out entry:billing:http:GET:/items heuristic baseUrlValue']);
    expect(result.project.unresolved.map((row) => row.reason)).toEqual(['base-url-from-files']);
  });

  it('settles nothing at a port no service is known at', () => {
    const result = linkGraphs([server('orders', 4001), server('billing', 4002), caller], config, { builtAt: FIXED, settings: settings(`http:${SLASHES}localhost:4999`) });
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => row.reason)).toEqual(['unknown-base-url-env']);
  });
});
