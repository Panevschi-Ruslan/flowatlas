import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { auditRoutes, matchesRoutePattern } from './route-audit.js';

const node = (id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type,
  label: id,
  repo: 'api',
  ...extra,
});

const edge = (from: string, type: GraphEdge['type'], to: string, extra: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type,
  confidence: 'static',
  ...extra,
});

const OPTIONS = { publicDecorators: ['Public'], publicRoutes: [] as string[] };

/** One route, its handler, and a query two calls away. */
const graph = (route: { meta?: Record<string, unknown>; guard?: boolean; data?: boolean }) => {
  const entry = node('entry:api:http:GET:/orders', 'entry', {
    kind: 'http',
    file: 'src/orders.controller.ts',
    line: 10,
    meta: { method: 'GET', path: '/orders', ...route.meta },
  });
  const nodes = [
    entry,
    node('api#OrdersController.list', 'method', { label: 'OrdersController.list' }),
    node('api#OrdersService.list', 'method'),
    node('db_query:api#1', 'db_query'),
    node('table:api#Order', 'table', { label: 'Order' }),
    node('api#JwtGuard', 'provider', { label: 'JwtGuard' }),
  ];
  const edges = [
    edge(entry.id, 'handles', 'api#OrdersController.list'),
    edge('api#OrdersController.list', 'calls', 'api#OrdersService.list'),
    ...(route.data === false ? [] : [edge('api#OrdersService.list', 'calls', 'db_query:api#1')]),
    edge('db_query:api#1', 'queries', 'table:api#Order'),
    ...(route.guard === true ? [edge(entry.id, 'guarded_by', 'api#JwtGuard', { meta: { layer: 'guard' } })] : []),
  ];
  return { nodes: new Map(nodes.map((item) => [item.id, item])), edges };
};

describe('a route nothing guards', () => {
  it('is reported when it reaches stored data, naming the data', () => {
    const { nodes, edges } = graph({});
    const [row] = auditRoutes(nodes, edges, OPTIONS);
    expect(row).toMatchObject({ reason: 'route-unguarded', file: 'src/orders.controller.ts', line: 10 });
    expect(row?.message).toBe('GET /orders has no guard in front of it and reaches Order.');
  });

  it('is left alone when a guard, a public decorator, a configured pattern or no data settles it', () => {
    const cases = [
      graph({ guard: true }),
      graph({ meta: { decorators: [{ name: 'Public', args: [] }] } }),
      graph({ data: false }),
    ];
    for (const { nodes, edges } of cases) expect(auditRoutes(nodes, edges, OPTIONS)).toEqual([]);
    const { nodes, edges } = graph({});
    expect(auditRoutes(nodes, edges, { ...OPTIONS, publicRoutes: ['GET /ord*'] })).toEqual([]);
  });

  it('does not count a rate limiter as a guard', () => {
    const { nodes, edges } = graph({ guard: true });
    (nodes.get('api#JwtGuard') as GraphNode).label = 'ThrottlerGuard';
    expect(auditRoutes(nodes, edges, { ...OPTIONS, nonGateWrappers: ['ThrottlerGuard'] }).map((row) => row.reason)).toEqual([
      'route-unguarded',
    ]);
  });

  it('audits a route whose decorator switches its guard off as if the guard were not there', () => {
    const skip = { skipGuardDecorators: { SkipAuth: ['JwtGuard'] } };
    const skipped = graph({ guard: true, meta: { decorators: [{ name: 'SkipAuth', args: [] }] } });
    const [row] = auditRoutes(skipped.nodes, skipped.edges, { ...OPTIONS, ...skip });
    expect(row).toMatchObject({ reason: 'route-unguarded' });
    expect(row?.message).toBe('GET /orders has no guard in front of it once JwtGuard (skipped by @SkipAuth), and reaches Order.');

    // Another guard it does not name still stands, and so does the same guard
    // on a route without the decorator.
    const other = graph({ guard: true, meta: { decorators: [{ name: 'SkipAuth', args: [] }] } });
    expect(auditRoutes(other.nodes, other.edges, { ...OPTIONS, skipGuardDecorators: { SkipAuth: ['ApiKeyGuard'] } })).toEqual([]);
    const plain = graph({ guard: true });
    expect(auditRoutes(plain.nodes, plain.edges, { ...OPTIONS, ...skip })).toEqual([]);

    // An empty list switches off every guard.
    const every = graph({ guard: true, meta: { decorators: [{ name: 'SkipAuth', args: [] }] } });
    expect(auditRoutes(every.nodes, every.edges, { ...OPTIONS, skipGuardDecorators: { SkipAuth: [] } })).toHaveLength(1);
  });

  it('lists a worker route as something to look at, since prefix middleware is not read', () => {
    const { nodes, edges } = graph({ meta: { registration: 'app.get' } });
    const [row] = auditRoutes(nodes, edges, OPTIONS);
    expect(row).toMatchObject({ reason: 'route-unguarded', level: 'info' });
  });

  it('matches a configured route by verb and pattern', () => {
    expect(matchesRoutePattern('* /api/health', 'GET', '/api/health')).toBe(true);
    expect(matchesRoutePattern('POST /api/*', 'GET', '/api/x')).toBe(false);
    expect(matchesRoutePattern('GET /api/:param/menu', 'GET', '/api/:param/menu')).toBe(true);
  });
});

describe('a worker route in front of an application route', () => {
  it('names both handlers and the guards that never run', () => {
    const { nodes, edges } = graph({ guard: true, meta: { controller: 'OrdersController', registration: 'app.get' } });
    nodes.set('api#worker.ts:listOrders', node('api#worker.ts:listOrders', 'function', { label: 'listOrders' }));
    edges.push(edge('entry:api:http:GET:/orders', 'handles', 'api#worker.ts:listOrders', { file: 'src/worker.ts', line: 40 }));
    const rows = auditRoutes(nodes, edges, OPTIONS);
    expect(rows.map((row) => row.reason)).toEqual(['route-shadowed']);
    expect(rows[0]).toMatchObject({ file: 'src/worker.ts', line: 40 });
    expect(rows[0]?.message).toBe(
      "GET /orders is answered by listOrders before OrdersController.list is reached; the application route's guards (JwtGuard) never run, and the worker route has no middleware.",
    );
  });
});
