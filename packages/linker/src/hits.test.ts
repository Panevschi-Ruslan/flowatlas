import {
  SCHEMA_VERSION,
  parseConfig,
  type FlowatlasConfig,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (web: Record<string, unknown> = {}): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'gateway', repo: './gateway', type: 'nestjs' },
      { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
      { name: 'web', repo: './web', type: 'angular', apiBaseEnv: ['apiUrl'], ...web },
    ],
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges: [],
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

const request = (meta: Record<string, unknown>, id = 'ui_api_call:web#src/api.ts:10:5'): GraphNode => ({
  id,
  type: 'ui_api_call',
  kind: 'http',
  label: 'request',
  repo: 'web',
  file: 'src/api.ts',
  line: 10,
  meta: { method: 'GET', path: '/orders/:param', baseUrlEnv: 'apiUrl', ...meta },
});

/** Both services answer `GET /orders/:param`, which is what makes them rivals. */
const backends = (): RepoGraph[] => [
  graph('gateway', [route('gateway', 'GET', '/orders/:param')]),
  graph('orders', [route('orders', 'GET', '/orders/:param')]),
];

const link = (call: GraphNode, cfg = config()) =>
  linkGraphs([...backends(), graph('web', [call])], cfg, { builtAt: FIXED });

const hits = (result: ReturnType<typeof link>) =>
  result.project.edges.filter((edge) => edge.type === 'hits');

describe('joining a request in the browser to the route that serves it', () => {
  it('takes the service the configuration names, and calls that proof', () => {
    const result = link(request({}), config({ apiTarget: { apiUrl: 'gateway' } }));
    expect(hits(result)[0]).toMatchObject({
      to: 'entry:gateway:http:GET:/orders/:param',
      confidence: 'static',
      meta: { via: 'api-target', targetService: 'gateway' },
    });
    expect(result.report.ui).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
  });

  it('takes the one service that claims the same settings key as its own base', () => {
    const result = link(
      request({ baseUrlEnv: 'ORDERS_URL' }),
      config({ apiBaseEnv: ['ORDERS_URL'] }),
    );
    expect(hits(result)[0]).toMatchObject({
      to: 'entry:orders:http:GET:/orders/:param',
      confidence: 'static',
      meta: { via: 'base-url-env' },
    });
  });

  it('guesses when exactly one service answers, and says it is a guess', () => {
    const result = link(request({ path: '/orders/:param/receipt', baseUrlEnv: null }));
    expect(hits(result)).toEqual([]);

    const single = linkGraphs(
      [
        graph('gateway', [route('gateway', 'POST', '/orders')]),
        graph('web', [request({ method: 'POST', path: '/orders', baseUrlEnv: null })]),
      ],
      config(),
      { builtAt: FIXED },
    );
    expect(single.project.edges.filter((edge) => edge.type === 'hits')[0]).toMatchObject({
      confidence: 'heuristic',
      meta: { via: 'unique-route' },
    });
  });

  it('refuses to choose when two services answer the same route', () => {
    const result = link(request({ baseUrlEnv: 'ordersUrl' }));
    expect(hits(result)).toEqual([]);
    expect(result.report.ui.byReason).toEqual({ 'ambiguous-route-target': 1 });
    expect(result.report.unresolved[0]?.hint).toContain('apiTarget');
  });

  it('says which service was asked when the route is the part that is missing', () => {
    const result = link(
      request({ path: '/orders/:param/receipt' }),
      config({ apiTarget: { apiUrl: 'gateway' } }),
    );
    expect(hits(result)).toEqual([]);
    expect(result.report.ui.byReason).toEqual({ 'target-route-not-found': 1 });
    expect(result.report.unresolved[0]?.message).toBe(
      'target service gateway has no route GET /orders/:param/receipt',
    );
  });

  it('says nothing serves a route no configured service has', () => {
    const result = link(request({ path: '/nowhere', baseUrlEnv: null }));
    expect(result.report.unresolved[0]?.message).toBe('no configured service serves GET /nowhere');
  });

  it('carries the types of both ends onto the edge', () => {
    const result = link(
      request({ responseType: 'type:web#OrderDto', bodyType: 'type:web#CreateOrderDto' }),
      config({ apiTarget: { apiUrl: 'gateway' } }),
    );
    expect(hits(result)[0]).toMatchObject({
      returns: 'type:web#OrderDto',
      params: ['type:web#CreateOrderDto'],
    });
  });

  it('never calls an address read through a guessed branch static', () => {
    const result = link(
      request({ guessed: true }),
      config({ apiTarget: { apiUrl: 'gateway' } }),
    );
    // The configuration names the service outright, so the far end is proof.
    // The path is not: the extractor took a branch the caller left open, and an
    // edge may not claim more than the weakest thing it rests on (R11).
    expect(hits(result)[0]).toMatchObject({
      to: 'entry:gateway:http:GET:/orders/:param',
      confidence: 'heuristic',
      meta: { via: 'api-target' },
    });
    expect(result.report.ui).toMatchObject({ total: 1, resolved: 1, unresolved: 0 });
  });

  it('never claims more than the annotation an address came from', () => {
    const result = link(request({ via: 'marker' }), config({ apiTarget: { apiUrl: 'gateway' } }));
    expect(hits(result)[0]?.confidence).toBe('marker');
  });

  it('counts an address built at run time without reporting it twice', () => {
    const result = link(request({ path: null, baseUrlEnv: null }));
    expect(result.report.ui).toMatchObject({
      total: 1,
      resolved: 0,
      unresolved: 1,
      byReason: { 'api-path-dynamic': 1 },
    });
    expect(result.report.unresolved).toEqual([]);
  });

  it('counts every request in exactly one bucket', () => {
    const result = linkGraphs(
      [
        ...backends(),
        graph('web', [
          request({}, 'ui_api_call:web#src/api.ts:1:1'),
          request({ path: '/orders/:param/receipt' }, 'ui_api_call:web#src/api.ts:2:1'),
          request({ path: null, baseUrlEnv: null }, 'ui_api_call:web#src/api.ts:3:1'),
        ]),
      ],
      config({ apiTarget: { apiUrl: 'gateway' } }),
      { builtAt: FIXED },
    );
    const { total, resolved, unresolved, byReason } = result.report.ui;
    expect(resolved + unresolved).toBe(total);
    expect(Object.values(byReason).reduce((sum, count) => sum + count, 0)).toBe(unresolved);
  });

  it('leaves the counts empty when no frontend was read', () => {
    const result = linkGraphs(backends(), config(), { builtAt: FIXED });
    expect(result.report.ui).toEqual({ total: 0, resolved: 0, unresolved: 0, byReason: {} });
  });

  it('counts a route a browser reaches as a route somebody calls', () => {
    const result = link(request({}), config({ apiTarget: { apiUrl: 'gateway' } }));
    expect(result.report.routes.uncalled).toEqual(['entry:orders:http:GET:/orders/:param']);
  });
});
