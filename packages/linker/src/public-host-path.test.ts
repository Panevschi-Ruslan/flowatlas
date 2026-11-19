import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphEdge, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
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

const route = (repo: string, method: string, path: string, meta: Record<string, unknown> = {}): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path, ...meta },
});


const request = (repo: string, meta: Record<string, unknown>, type: 'http_out' | 'ui_api_call' = 'http_out'): GraphNode => ({
  id: `${type}:${repo}#src/call.ts:4:9`,
  type,
  kind: 'http',
  label: `${String(meta['method'])} ${String(meta['path'])}`,
  repo,
  file: 'src/call.ts',
  line: 4,
  meta,
});

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls')
    .map((edge) => `${edge.from.split(':')[0]} ${edge.to} ${edge.confidence} ${String(edge.meta?.['via'])}`)
    .sort();

const config = (services: readonly { name: string; type: string; baseUrlEnv?: string[] }[]) =>
  parseConfig({ services: services.map((service) => ({ ...service, repo: `./${service.name}` })) } as Parameters<typeof parseConfig>[0]);

describe('a server request under a public host whose path serves nothing (P301)', () => {
  const services = config([
    { name: 'jobs', type: 'express' },
    { name: 'catalog', type: 'express' },
    { name: 'orders', type: 'express' },
  ]);
  const settings = (value: string): Record<string, RepoSettings> => ({ jobs: { ...NO_SETTINGS, values: { SHOP_URL: [{ value, file: '.env.example' }] } } });
  const jobs = (path: string, meta: Record<string, unknown> = {}) => graph('jobs', [request('jobs', { method: 'GET', path, baseUrlEnv: 'SHOP_URL', ...meta })]);
  const targets = [
    graph('catalog', [route('catalog', 'GET', '/items'), route('catalog', 'GET', '/health'), route('catalog', 'GET', '/v2/stock')]),
    graph('orders', [route('orders', 'GET', '/health'), route('orders', 'GET', '/v2/stock')]),
  ];
  const under = settings(`https:${SLASHES}shop.example.test/api`);

  it('joins the one service serving its own path, as a guess, as a browser request under the value is', () => {
    expect(joins(linkGraphs([...targets, jobs('/items')], services, { builtAt: FIXED, settings: under }))).toEqual(['http_out entry:catalog:http:GET:/items heuristic externalValuePath']);
  });

  it('is a row naming each service, and the path nothing is served under, where several serve its own path', () => {
    const result = linkGraphs([...targets, jobs('/health')], services, { builtAt: FIXED, settings: under });
    expect(joins(result)).toEqual([]);
    const row = result.project.unresolved.find((each) => each.reason === 'ambiguous-route-target');
    expect(row?.message).toContain('under whose path /api no service serves the request');
    expect(row?.message).toContain('GET /health is served by catalog and orders');
  });

  it('keeps the address under the value where one service serves it there, and names both where two do', () => {
    const v2 = settings(`https:${SLASHES}shop.example.test/v2`);
    const withV2 = [graph('catalog', [route('catalog', 'GET', '/v2/items'), route('catalog', 'GET', '/items'), route('catalog', 'GET', '/v2/stock')]), targets[1] as RepoGraph];
    expect(joins(linkGraphs([...withV2, jobs('/items')], services, { builtAt: FIXED, settings: v2 }))).toEqual(['http_out entry:catalog:http:GET:/v2/items heuristic externalValuePath']);
    const shared = linkGraphs([...withV2, jobs('/stock')], services, { builtAt: FIXED, settings: v2 });
    expect(joins(shared)).toEqual([]);
    expect(shared.project.unresolved.find((each) => each.reason === 'ambiguous-route-target')?.message).toContain('GET /v2/stock is served by catalog and orders');
  });

  it('leaves a request nobody serves, and an operation, to a third party', () => {
    expect(joins(linkGraphs([...targets, jobs('/nowhere')], services, { builtAt: FIXED, settings: under }))).toEqual([]);
    expect(joins(linkGraphs([...targets, jobs('/items', { graphql: { operation: 'Items' } })], services, { builtAt: FIXED, settings: under }))).toEqual([]);
  });
});
