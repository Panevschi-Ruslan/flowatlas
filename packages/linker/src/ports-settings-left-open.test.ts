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

const listening = (repo: string, ports: readonly Record<string, unknown>[]): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: ports } });

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

describe("a framework's default port (P296)", () => {
  const web = (ports: readonly Record<string, unknown>[]) =>
    graph('web', [
      listening('web', ports),
      route('web', 'POST', '/api/auth/verify'),
      request('web', { method: 'POST', path: '/api/auth/verify', baseUrlEnv: 'PUBLIC_APP_URL', baseUrlDefault: `http:${SLASHES}localhost:3000`, baseUrlDefaultFrom: 'lib/constants.ts' }),
    ]);

  it("places a value at the default port at the full-stack application listening there, the fallback said in the module it is written in", () => {
    const result = linkGraphs([web([{ port: 3000, file: 'package.json', line: 5, setting: 'PORT', default: true }])], config([{ name: 'web', type: 'nextjs' }]), { builtAt: FIXED });
    expect(joins(result)).toEqual(['http_out entry:web:http:POST:/api/auth/verify heuristic baseUrlValue']);
    const [row] = result.project.unresolved;
    expect(row?.reason).toBe('base-url-from-files');
    expect(row?.message).toContain('lib/constants.ts');
  });

  it('yields a default to a service the code places on the same port', () => {
    const api = graph('api', [listening('api', [{ port: 3000, file: 'src/main.ts', line: 3 }]), route('api', 'POST', '/api/auth/verify')]);
    const result = linkGraphs([web([{ port: 3000, file: 'package.json', line: 5, setting: 'PORT', default: true }]), api], config([{ name: 'web', type: 'nextjs' }, { name: 'api', type: 'express' }]), { builtAt: FIXED });
    expect(joins(result)).toEqual(['http_out entry:api:http:POST:/api/auth/verify heuristic baseUrlValue']);
  });

  it('leaves two defaults on one port as no answer', () => {
    const other = graph('admin', [listening('admin', [{ port: 3000, file: 'package.json', line: 4, setting: 'PORT', default: true }]), route('admin', 'POST', '/api/auth/verify')]);
    const result = linkGraphs([web([{ port: 3000, file: 'package.json', line: 5, setting: 'PORT', default: true }]), other], config([{ name: 'web', type: 'nextjs' }, { name: 'admin', type: 'nextjs' }]), { builtAt: FIXED });
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => row.reason)).toEqual(['unknown-base-url-env']);
  });
});

describe('the settings a chain of || reads after the first (P296)', () => {
  const services = config([
    { name: 'shop', type: 'express' },
    { name: 'catalog', type: 'express', baseUrlEnv: ['CATALOG_URL'] },
    { name: 'orders', type: 'express' },
  ]);
  const targets = [graph('catalog', [route('catalog', 'GET', '/items')]), graph('orders', [listening('orders', [{ port: 4100, file: 'src/main.ts', line: 2 }]), route('orders', 'GET', '/items')])];

  it('joins the service claiming a later setting where nobody claims the first', () => {
    const shop = graph('shop', [request('shop', { method: 'GET', path: '/items', baseUrlEnv: 'PUBLIC_URL', baseUrlAlso: ['CATALOG_URL'] })]);
    expect(joins(linkGraphs([...targets, shop], services, { builtAt: FIXED }))).toEqual(['http_out entry:catalog:http:GET:/items static baseUrlEnv']);
  });

  it("takes a later setting's values as the chain's", () => {
    const shop = graph('shop', [request('shop', { method: 'GET', path: '/items', baseUrlEnv: 'PUBLIC_URL', baseUrlAlso: ['UPSTREAM_URL'] })]);
    const settings: Record<string, RepoSettings> = { shop: { ...NO_SETTINGS, values: { UPSTREAM_URL: [{ value: `http:${SLASHES}localhost:4100`, file: '.env.example' }] } } };
    expect(joins(linkGraphs([...targets, shop], services, { builtAt: FIXED, settings }))).toEqual(['http_out entry:orders:http:GET:/items heuristic baseUrlValue']);
  });
});

describe('a server request under a public host with no path (P296)', () => {
  const services = config([
    { name: 'jobs', type: 'express' },
    { name: 'catalog', type: 'express' },
    { name: 'orders', type: 'express' },
  ]);
  const settings: Record<string, RepoSettings> = { jobs: { ...NO_SETTINGS, values: { SHOP_HOST: [{ value: `https:${SLASHES}shop.example.test`, file: '.env.example' }] } } };
  const jobs = (path: string) => graph('jobs', [request('jobs', { method: 'GET', path, baseUrlEnv: 'SHOP_HOST' })]);
  const targets = [graph('catalog', [route('catalog', 'GET', '/items'), route('catalog', 'GET', '/health')]), graph('orders', [route('orders', 'GET', '/health')])];

  it('joins the one service serving its path, as a guess, as a browser request under the host is', () => {
    expect(joins(linkGraphs([...targets, jobs('/items')], services, { builtAt: FIXED, settings }))).toEqual(['http_out entry:catalog:http:GET:/items heuristic externalValuePath']);
  });

  it('is a row naming each service where several serve the path', () => {
    const result = linkGraphs([...targets, jobs('/health')], services, { builtAt: FIXED, settings });
    expect(joins(result)).toEqual([]);
    const row = result.project.unresolved.find((each) => each.reason === 'ambiguous-route-target');
    expect(row?.message).toContain('catalog and orders');
  });
});

describe('a GraphQL operation under a public host whose path no endpoint serves (P296)', () => {
  const endpoint = (repo: string, path: string, fields: Record<string, unknown>) =>
    route(repo, 'POST', path, { graphql: { endpoint: true, schema: { roots: { query: 'Query' }, types: { Query: { fields } } } } });
  const operation = (field: string) =>
    request('portal', { method: 'POST', path: '/', baseUrlEnv: 'GATEWAY_URL', client: 'graphql-request', graphql: { operation: 'query', fields: [{ field, line: 4 }], document: { file: 'src/call.ts', line: 4 } } }, 'ui_api_call');
  const settings: Record<string, RepoSettings> = { portal: { ...NO_SETTINGS, values: { GATEWAY_URL: [{ value: `https:${SLASHES}gateway.example.test/v1`, file: 'wrangler.toml' }] } } };
  const services = config([
    { name: 'portal', type: 'react' },
    { name: 'reviews', type: 'nestjs' },
    { name: 'ratings', type: 'nestjs' },
  ]);

  it('joins the one endpoint declaring a root field it asks for', () => {
    const graphs = [graph('reviews', [endpoint('reviews', '/graphql', { reviews: {} })]), graph('ratings', [endpoint('ratings', '/graphql', { ratings: {} })]), graph('portal', [operation('reviews')])];
    expect(joins(linkGraphs(graphs, services, { builtAt: FIXED, settings }))).toEqual(['ui_api_call entry:reviews:http:POST:/graphql heuristic graphql-path']);
  });

  it('is a row naming both where two endpoints declare it', () => {
    const graphs = [graph('reviews', [endpoint('reviews', '/graphql', { reviews: {} })]), graph('ratings', [endpoint('ratings', '/graphql', { reviews: {} })]), graph('portal', [operation('reviews')])];
    const result = linkGraphs(graphs, services, { builtAt: FIXED, settings });
    expect(joins(result)).toEqual([]);
    expect(result.project.unresolved.map((row) => row.reason)).toContain('ambiguous-route-target');
  });
});
