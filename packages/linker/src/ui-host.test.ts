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

/** Two services that both serve `GET /items`, so the route alone settles nothing. */
const config = (orders: Record<string, unknown> = {}): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'orders', repo: './orders', type: 'nestjs', ...orders },
      { name: 'billing', repo: './billing', type: 'nestjs' },
      { name: 'web', repo: './web', type: 'react' },
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

const route = (repo: string): GraphNode => ({
  id: `entry:${repo}:http:GET:/items`,
  type: 'entry',
  kind: 'http',
  label: 'GET /items',
  repo,
  meta: { method: 'GET', path: '/items' },
});

const CALL = 'ui_api_call:web#src/api.ts:3:1';
const EXTERNAL = 'external_api:orders.example.test';

/** The request a browser reader records under `axios.create({ baseURL: 'https://orders.example.test' })`, and the host edge it draws. */
const web = (): RepoGraph =>
  graph(
    'web',
    [
      {
        id: CALL,
        type: 'ui_api_call',
        kind: 'http',
        label: 'GET /items',
        repo: 'web',
        file: 'src/api.ts',
        line: 3,
        meta: { method: 'GET', url: 'https://orders.example.test/items', path: '/items', baseUrlEnv: null, host: 'orders.example.test' },
      },
      { id: EXTERNAL, type: 'external_api', label: 'orders.example.test', repo: 'web', meta: { host: 'orders.example.test' } },
    ],
    [{ from: CALL, to: EXTERNAL, type: 'calls', confidence: 'static' }],
  );

const link = (cfg: FlowatlasConfig, settings?: Record<string, RepoSettings>) =>
  linkGraphs([graph('orders', [route('orders')]), graph('billing', [route('billing')]), web()], cfg, {
    builtAt: FIXED,
    ...(settings === undefined ? {} : { settings }),
  });

const hits = (result: ReturnType<typeof link>) => result.project.edges.filter((edge) => edge.type === 'hits');

describe('a browser request whose address names the host of a configured service (P239)', () => {
  it('is ambiguous by its route alone', () => {
    const result = link(config());
    expect(hits(result)).toEqual([]);
    expect(result.report.ui).toMatchObject({ resolved: 0, byReason: { 'ambiguous-route-target': 1 } });
  });

  it('joins the service the configuration says is reached at that host, static, and is no third party', () => {
    const result = link(config({ hosts: ['orders.example.test'] }));
    expect(hits(result)).toMatchObject([{ from: CALL, to: 'entry:orders:http:GET:/items', confidence: 'static', meta: { via: 'host', targetService: 'orders' } }]);
    expect(result.project.nodes.some((node) => node.id === EXTERNAL)).toBe(false);
    expect(result.project.edges.some((edge) => edge.to === EXTERNAL)).toBe(false);
  });

  it('joins by an alias as by a host', () => {
    const result = link(config({ aliases: ['orders.example.test'] }));
    expect(hits(result)[0]).toMatchObject({ confidence: 'static', meta: { via: 'host' } });
  });

  it('joins as a guess where only the service files name the host', () => {
    const settings: Record<string, RepoSettings> = {
      orders: { values: {}, namedOnly: {}, hosts: [{ host: 'orders.example.test', file: '.env.example' }] },
    };
    const result = link(config(), settings);
    expect(hits(result)).toMatchObject([{ to: 'entry:orders:http:GET:/items', confidence: 'heuristic', meta: { via: 'host' } }]);
  });
});
