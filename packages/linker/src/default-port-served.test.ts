import { NO_SETTINGS, SCHEMA_VERSION, parseConfig, type GraphEdge, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';
import { atLocalPort, type PortIndex } from './local-port.js';
import { servesRequest } from './request-served.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const SLASHES = '/'.repeat(2);
const LOCAL = `http:${SLASHES}localhost:3000`;

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

const endpoint = (repo: string, path: string, fields: Record<string, unknown>): GraphNode =>
  route(repo, 'POST', path, { graphql: { endpoint: true, schema: { roots: { query: 'Query' }, types: { Query: { fields } } } } });

/** A full-stack framework's own server, on the port it assumes where nothing says (P296). */
const assumed = (repo: string): GraphNode => ({ id: `repo:${repo}`, type: 'repo', label: repo, repo, meta: { listen: [{ port: 3000, file: 'package.json', line: 5, setting: 'PORT', default: true }] } });

const request = (repo: string, meta: Record<string, unknown>, at = 4, type: 'http_out' | 'ui_api_call' = 'http_out'): GraphNode => ({
  id: `${type}:${repo}#src/call.ts:${at}:9`,
  type,
  kind: 'http',
  label: `${String(meta['method'])} ${String(meta['path'])}`,
  repo,
  file: 'src/call.ts',
  line: at,
  meta,
});

const joins = (result: ReturnType<typeof linkGraphs>) =>
  result.project.edges
    .filter((edge) => edge.type === 'hits' || edge.type === 'http_calls')
    .map((edge) => `${edge.from.split('#')[0]} ${edge.to} ${String(edge.meta?.['via'])}`)
    .sort();

const config = (services: readonly { name: string; type: string }[]) =>
  parseConfig({ services: services.map((service) => ({ ...service, repo: `./${service.name}` })) } as Parameters<typeof parseConfig>[0]);

const services = config([
  { name: 'portal', type: 'remix' },
  { name: 'docs', type: 'nextjs' },
  { name: 'catalog', type: 'express' },
]);

describe("a port only a framework assumes (P300)", () => {
  // portal and docs each listen on 3000 by default; catalog serves /items and states no port.
  const targets = [graph('docs', [assumed('docs'), route('docs', 'GET', '/guides')]), graph('catalog', [route('catalog', 'GET', '/items')])];
  const portal = (calls: GraphNode[]) => graph('portal', [assumed('portal'), route('portal', 'GET', '/account'), ...calls]);
  const settings = (value: string): Record<string, RepoSettings> => ({ portal: { ...NO_SETTINGS, values: { CATALOG_URL: [{ value, file: '.env.example' }] } } });

  it('places no request at a service the port only assumes where it does not serve it: the request falls back to the name', () => {
    const graphs = [...targets, portal([request('portal', { method: 'GET', path: '/items', baseUrlEnv: 'CATALOG_URL' })])];
    const result = linkGraphs(graphs, services, { builtAt: FIXED, settings: settings(LOCAL) });
    expect(joins(result)).toEqual(['http_out:portal entry:catalog:http:GET:/items baseUrlValue']);
    expect(result.project.unresolved.map((row) => row.reason)).not.toContain('target-route-not-found');
  });

  it('places a request where the service the port assumes serves it', () => {
    const graphs = [...targets, portal([request('portal', { method: 'GET', path: '/account', baseUrlEnv: 'CATALOG_URL' })])];
    expect(joins(linkGraphs(graphs, services, { builtAt: FIXED, settings: settings(LOCAL) }))).toEqual(['http_out:portal entry:portal:http:GET:/account baseUrlValue']);
  });

  it("joins a GraphQL operation by the value's path where the service the port assumes serves no endpoint there", () => {
    const store = graph('catalog', [endpoint('catalog', '/store-api', { products: {} })]);
    const operation = request('portal', {
      method: 'POST',
      path: '/',
      baseUrlEnv: 'STORE_API_URL',
      client: 'codegen-sdk',
      graphql: { operation: 'query', fields: [{ field: 'products', line: 4 }], document: { file: 'src/call.ts', line: 4 } },
    });
    const own: Record<string, RepoSettings> = { portal: { ...NO_SETTINGS, values: { STORE_API_URL: [{ value: `${LOCAL}/store-api`, file: '.env.example' }] } } };
    // portal alone assumes 3000 here, and the server serving the endpoint there states no port.
    const result = linkGraphs([store, portal([operation])], services, { builtAt: FIXED, settings: own });
    expect(joins(result)).toEqual(['http_out:portal entry:catalog:http:POST:/store-api graphqlPath']);
    expect(result.project.unresolved.map((row) => row.reason)).not.toContain('target-route-not-found');
  });

  it('asks a host written in the request the same, for a server and for a browser', () => {
    const server = request('portal', { method: 'GET', path: '/items', host: 'localhost:3000', url: `${LOCAL}/items` });
    const browser = request('portal', { method: 'GET', path: '/items', host: 'localhost:3000', url: `${LOCAL}/items` }, 6, 'ui_api_call');
    const result = linkGraphs([...targets, portal([server, browser])], services, { builtAt: FIXED });
    expect(result.project.unresolved.map((row) => row.reason)).not.toContain('target-route-not-found');
    expect(joins(result).filter((each) => each.includes('entry:portal'))).toEqual([]);
    const served = request('portal', { method: 'GET', path: '/account', host: 'localhost:3000', url: `${LOCAL}/account` });
    expect(joins(linkGraphs([...targets, portal([served])], services, { builtAt: FIXED }))).toEqual(['http_out:portal entry:portal:http:GET:/account host']);
  });
});

describe('atLocalPort with what the request asks (P300)', () => {
  const routes: Record<string, GraphNode[]> = { portal: [route('portal', 'GET', '/account')], docs: [route('docs', 'GET', '/guides'), route('docs', 'GET', '/files/*')] };
  const listening = new Map([[3000, [{ service: 'docs', file: 'package.json', line: 4, default: true as const }, { service: 'portal', file: 'package.json', line: 5, default: true as const }]]]);
  const index: PortIndex = { configured: new Map(), all: new Map(), listening };
  const asked = (method: string, path: string) => servesRequest((service) => routes[service], { method, paths: [path] });

  it('answers with the one assumed service serving the request, a catch-all included', () => {
    expect(atLocalPort(`${LOCAL}/account`, index, asked('GET', '/account'))).toMatchObject({ kind: 'service', service: 'portal', sure: false });
    expect(atLocalPort(`${LOCAL}/files/a.txt`, index, asked('GET', '/files/a.txt'))).toMatchObject({ kind: 'service', service: 'docs' });
  });

  it('answers nothing where none serves it, or nothing says what is asked', () => {
    expect(atLocalPort(`${LOCAL}/items`, index, asked('GET', '/items'))).toBeUndefined();
    expect(atLocalPort(`${LOCAL}/account`, index)).toBeUndefined();
  });

  it('keeps a port a file or the code places firm, whatever the request asks', () => {
    const placed: PortIndex = { ...index, listening: new Map([[3000, [{ service: 'catalog', file: 'src/main.ts', line: 2 }, ...(listening.get(3000) ?? [])]]]) };
    expect(atLocalPort(`${LOCAL}/account`, placed, asked('GET', '/account'))).toMatchObject({ kind: 'service', service: 'catalog' });
  });
});
