import {
  SCHEMA_VERSION,
  parseConfig,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type RepoSettings,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

/** Two services that both serve `GET /items`, and a third that calls one of them by its host. */
const config = (orders: Record<string, unknown> = {}): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'orders', repo: './orders', type: 'nestjs', ...orders },
      { name: 'billing', repo: './billing', type: 'nestjs' },
      { name: 'reports', repo: './reports', type: 'nestjs' },
    ],
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges,
  types: {},
  unresolved: [],
});

const route = (repo: string, method = 'GET', path = '/items'): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

const CALL = 'http_out:reports#src/sync.ts:4:9';
const EXTERNAL = 'external_api:orders.example.test';

/** The request a server reader records for `fetch('https://orders.example.test/items')`, and the host edge it draws. */
const reports = (path = '/items', host = 'orders.example.test'): RepoGraph =>
  graph(
    'reports',
    [
      {
        id: CALL,
        type: 'http_out',
        kind: 'http',
        label: `GET ${path}`,
        repo: 'reports',
        file: 'src/sync.ts',
        line: 4,
        meta: { method: 'GET', url: `https:${'/'.repeat(2)}${host}${path}`, path, host },
      },
      { id: `external_api:${host}`, type: 'external_api', label: host, repo: 'reports', meta: { host } },
    ],
    [{ from: CALL, to: `external_api:${host}`, type: 'calls', confidence: 'static' }],
  );

const link = (cfg: FlowatlasConfig, caller = reports(), settings?: Record<string, RepoSettings>) =>
  linkGraphs([graph('orders', [route('orders')]), graph('billing', [route('billing')]), caller], cfg, {
    builtAt: FIXED,
    ...(settings === undefined ? {} : { settings }),
  });

const calls = (result: ReturnType<typeof link>) => result.project.edges.filter((edge) => edge.type === 'http_calls');

describe('a request between services whose address names the host of a configured service (P244)', () => {
  it('stays external where no service is reached at that host', () => {
    const result = link(config());
    expect(calls(result)).toEqual([]);
    expect(result.report.httpOut).toMatchObject({ total: 1, linked: 0, external: 1 });
    expect(result.project.nodes.some((node) => node.id === EXTERNAL)).toBe(true);
  });

  it('joins the service services[].hosts names, static, and is no third party', () => {
    const result = link(config({ hosts: ['orders.example.test'] }));
    expect(calls(result)).toMatchObject([{ from: CALL, to: 'entry:orders:http:GET:/items', confidence: 'static', meta: { via: 'host', targetService: 'orders' } }]);
    expect(result.report.httpOut).toMatchObject({ total: 1, linked: 1, external: 0 });
    expect(result.project.nodes.some((node) => node.id === EXTERNAL)).toBe(false);
    expect(result.project.edges.some((edge) => edge.to === EXTERNAL)).toBe(false);
  });

  it('joins by an alias as by a host', () => {
    const result = link(config({ aliases: ['orders.example.test'] }));
    expect(calls(result)[0]).toMatchObject({ confidence: 'static', meta: { via: 'host' } });
  });

  it('joins a name only the network the project runs in resolves by the service it names (P77)', () => {
    const result = link(config(), reports('/items', 'orders.default.svc.cluster.local'));
    expect(calls(result)).toMatchObject([{ to: 'entry:orders:http:GET:/items', confidence: 'static', meta: { via: 'host' } }]);
  });

  it('joins as a guess where only the service files name the host', () => {
    const settings: Record<string, RepoSettings> = {
      orders: { values: {}, namedOnly: {}, hosts: [{ host: 'orders.example.test', file: '.env.example' }] },
    };
    const result = link(config(), reports(), settings);
    expect(calls(result)).toMatchObject([{ to: 'entry:orders:http:GET:/items', confidence: 'heuristic', meta: { via: 'host' } }]);
  });

  it('says the route is missing at the service the host names, rather than calling it a third party', () => {
    const result = link(config({ hosts: ['orders.example.test'] }), reports('/missing'));
    expect(calls(result)).toEqual([]);
    expect(result.report.httpOut).toMatchObject({ linked: 0, noRoute: 1, external: 0 });
    expect(result.report.unresolved.find((row) => row.symbol === CALL)).toMatchObject({ reason: 'target-route-not-found' });
  });
});
