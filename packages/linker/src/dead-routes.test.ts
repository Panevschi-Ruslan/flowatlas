import { SCHEMA_VERSION, parseConfig, type GraphEdge, type GraphNode, type RepoGraph, type RepoSettings } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

/**
 * The callers `dead` used to miss, and the ones it may not claim (P91): a
 * service named by an alias, a worker's binding, a variable holding a whole
 * address, a verb nobody read, and a request read in part that could still
 * reach a route nothing calls.
 */
const FIXED = '2026-01-01T00:00:00.000Z';

const config = (extra: Record<string, unknown> = {}) =>
  parseConfig({
    services: [
      { name: 'catalog-api', repo: './catalog', type: 'nestjs', aliases: ['catalog', 'catalog-worker'] },
      { name: 'orders', repo: './orders', type: 'nestjs' },
      { name: 'stock', repo: './stock', type: 'nestjs' },
    ],
    ...extra,
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

const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

const CATALOG = [
  route('catalog-api', 'GET', '/items'),
  route('catalog-api', 'GET', '/items/:param'),
  route('catalog-api', 'GET', '/items/:param/price'),
  route('catalog-api', 'GET', '/items/export'),
  route('catalog-api', 'POST', '/items/reindex'),
];

let at = 0;
const call = (meta: Record<string, unknown>, repo = 'orders'): GraphNode => {
  at += 1;
  return {
    id: `http_out:${repo}#src/worker.ts:${at}:1`,
    type: 'http_out',
    label: 'request',
    repo,
    file: 'src/worker.ts',
    line: at,
    meta: { method: 'GET', url: null, path: null, baseUrlEnv: null, ...meta },
  };
};

/** A method that makes the call, carrying what annotations it was given. */
const annotated = (request: GraphNode, markers: unknown[]): [GraphNode, GraphEdge] => {
  const method: GraphNode = { id: `orders#src/worker.ts:Worker.m${request.line}`, type: 'method', label: 'Worker.m', repo: 'orders', meta: { markers } };
  return [method, { from: method.id, to: request.id, type: 'calls', confidence: 'static' }];
};

const link = (nodes: GraphNode[], edges: GraphEdge[] = [], settings: Record<string, RepoSettings> = {}, cfg = config()) =>
  linkGraphs([graph('catalog-api', CATALOG), graph('orders', nodes, edges), graph('stock', [])], cfg, { builtAt: FIXED, settings });

const joined = (result: ReturnType<typeof link>) =>
  result.project.edges.filter((edge) => edge.type === 'http_calls').map((edge) => `${edge.to} ${edge.confidence} ${String(edge.meta?.['via'])}`);
const rows = (result: ReturnType<typeof link>) => result.report.unresolved.map((row) => `${row.reason}: ${row.message ?? ''}`);

const bound = (bindings: RepoSettings['bindings'], extra: Partial<RepoSettings> = {}): Record<string, RepoSettings> => ({
  orders: { values: {}, namedOnly: {}, hosts: [], bindings, ...extra },
});

describe('a service named by an alias', () => {
  it('joins an annotation naming the alias to the service it names', () => {
    const request = call({});
    const [method, edge] = annotated(request, [{ name: 'CallsService', args: ['catalog', 'GET /items'] }]);
    expect(joined(link([request, method], [edge]))).toEqual(['entry:catalog-api:http:GET:/items marker marker']);
  });

  it('names the aliases it tried when an annotation names no service', () => {
    const request = call({});
    const [method, edge] = annotated(request, [{ name: 'CallsService', args: ['catalogue', 'GET /items'] }]);
    expect(rows(link([request, method], [edge]))).toContain(
      'marker-service-unknown: @CallsService names catalogue, which is not a configured service nor an alias of one (the aliases are catalog, catalog-worker)',
    );
  });

  it('takes a value whose host is an alias as the service', () => {
    const request = call({ path: '/items/:param', baseUrlEnv: 'CATALOG_URL' });
    const settings = { orders: { values: { CATALOG_URL: [{ value: 'http://catalog:3000', file: '.env.example' }] }, namedOnly: {}, hosts: [] } };
    expect(joined(link([request], [], settings))).toEqual(['entry:catalog-api:http:GET:/items/:param heuristic baseUrlValue']);
  });
});

describe('a worker’s binding', () => {
  const through = (meta: Record<string, unknown> = {}) => call({ path: '/items/:param', url: 'https://catalog/items/${…}', binding: 'CATALOG', ...meta });

  it('joins the request to the service its worker is, by alias, at static', () => {
    const result = link([through()], [], bound([{ binding: 'CATALOG', service: 'catalog-worker', file: 'wrangler.jsonc' }]));
    expect(joined(result)).toEqual(['entry:catalog-api:http:GET:/items/:param static serviceBinding']);
  });

  it('joins by the name a service’s own deployment files deploy it under', () => {
    const settings = {
      ...bound([{ binding: 'STOCK', service: 'stock-v2', file: 'wrangler.toml' }]),
      'catalog-api': { values: {}, namedOnly: {}, hosts: [], deployedAs: ['stock-v2'] },
    };
    expect(joined(link([through({ binding: 'STOCK' })], [], settings))).toEqual(['entry:catalog-api:http:GET:/items/:param static serviceBinding']);
  });

  it('says so when the worker it is bound to is no configured service', () => {
    const result = link([through()], [], bound([{ binding: 'CATALOG', service: 'books-worker', file: 'wrangler.jsonc' }]));
    expect(joined(result)).toEqual([]);
    expect(rows(result)).toEqual([
      'service-binding-unknown: CATALOG is bound to books-worker, which no configured service is named or aliased as',
    ]);
    expect(result.report.httpOut.unknownEnv).toBe(1);
  });

  it('says so when nothing declares a binding the type says it is, and nothing when only its shape did', () => {
    expect(rows(link([through()]))).toEqual([
      'service-binding-unknown: the request goes through the binding CATALOG, which no deployment file of this service declares',
    ]);
    expect(rows(link([through({ bindingTyped: false })]))).toEqual([]);
  });
});

describe('a variable holding a whole address', () => {
  it('takes the value’s path as where the request goes', () => {
    const request = call({ method: 'POST', path: '', url: '${REINDEX_URL}', baseUrlEnv: 'REINDEX_URL' });
    const settings = { orders: { values: { REINDEX_URL: [{ value: 'https://catalog.internal/items/reindex', file: '.env.example' }] }, namedOnly: {}, hosts: [] } };
    const cfg = parseConfig({
      services: [
        { name: 'catalog-api', repo: './catalog', type: 'nestjs', hosts: ['catalog.internal'] },
        { name: 'orders', repo: './orders', type: 'nestjs' },
        { name: 'stock', repo: './stock', type: 'nestjs' },
      ],
    });
    expect(joined(link([request], [], settings, cfg))).toEqual(['entry:catalog-api:http:POST:/items/reindex heuristic baseUrlValue']);
  });

  it('keeps the join made without the value’s path where only that one answers', () => {
    const request = call({ path: '/items', url: '${CATALOG_URL}/items', baseUrlEnv: 'CATALOG_URL' });
    const settings = { orders: { values: { CATALOG_URL: [{ value: 'http://catalog:3000/v1', file: '.env.example' }] }, namedOnly: {}, hosts: [] } };
    expect(joined(link([request], [], settings))).toEqual(['entry:catalog-api:http:GET:/items heuristic baseUrlValue']);
  });
});

describe('a request that could still reach a route nothing calls', () => {
  const claimed = config({});
  const cfg = parseConfig({
    services: claimed.services.map((service) => (service.name === 'catalog-api' ? { ...service, baseUrlEnv: ['CATALOG_URL'] } : service)),
  });

  it('is named against the routes its partly read address matches, and joins nothing', () => {
    const request = call({ path: '/items/:param/${…}', url: '${CATALOG_URL}/items/:param/${…}', baseUrlEnv: 'CATALOG_URL' });
    const result = link([request], [], {}, cfg);
    expect(joined(result)).toEqual([]);
    expect(result.report.routes.nearMissed).toEqual({ 'entry:catalog-api:http:GET:/items/:param/price': [request.id] });
  });

  it('counts a verb nobody read as any verb, at an address read in full', () => {
    const request = call({ method: null, path: '/items/reindex', url: '${CATALOG_URL}/items/reindex', baseUrlEnv: 'CATALOG_URL' });
    const result = link([request], [], {}, cfg);
    expect(joined(result)).toEqual([]);
    // Sent as a GET it is `/items/:param`'s; as a POST, `/items/reindex`'s.
    expect(result.report.routes.nearMissed).toEqual({
      'entry:catalog-api:http:GET:/items/:param': [request.id],
      'entry:catalog-api:http:POST:/items/reindex': [request.id],
    });
  });

  it('leaves the report as it was where nothing comes near', () => {
    const result = link([call({ path: '/items', url: '${CATALOG_URL}/items', baseUrlEnv: 'CATALOG_URL' })], [], {}, cfg);
    expect(result.report.routes.nearMissed).toBeUndefined();
  });
});
