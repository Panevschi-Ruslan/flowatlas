import { describe, expect, it } from 'vitest';
import { registeredFirst, routeOrderOf, routerOf, shadowsByPath, type OrderedRoute } from './route-order.js';

const at = (method: string, path: string, extra: Partial<OrderedRoute> & { meta?: Record<string, unknown> } = {}): OrderedRoute => ({
  repo: 'shop',
  file: 'src/orders.controller.ts',
  line: 1,
  ...extra,
  meta: { method, path, adapter: 'nestjs-http', controller: 'OrdersController', ...extra.meta },
});

describe('routeOrderOf (P385)', () => {
  it('reads the routers that try routes in order by their reader', () => {
    for (const adapter of ['nestjs-http', 'express-routes', 'koa-routes', 'hono-routes']) {
      expect(routeOrderOf({ meta: { adapter } })).toBe('declaration');
    }
    for (const adapter of ['fastify-routes', 'nextjs-routes', 'react-router-routes']) {
      expect(routeOrderOf({ meta: { adapter } })).toBe('specificity');
    }
  });

  it('takes what the route says over its reader', () => {
    expect(routeOrderOf({ meta: { adapter: 'nestjs-http', routeOrder: 'specificity' } })).toBe('specificity');
    expect(routeOrderOf({ meta: { adapter: 'nestjs-http', routeOrder: 'unread' } })).toBe('unread');
  });
});

describe('shadowsByPath (P385)', () => {
  it('holds where the first takes with a parameter every value the second spells out', () => {
    expect(shadowsByPath(at('GET', '/orders/:param', { meta: { rawPath: '/orders/:orderId' } }), at('GET', '/orders/latest'))).toBe(true);
    expect(shadowsByPath(at('GET', '/a/:param/:param'), at('GET', '/a/b/:param'))).toBe(true);
  });

  it('never holds the other way round, across verbs, for every verb, or for a wildcard', () => {
    expect(shadowsByPath(at('GET', '/orders/latest'), at('GET', '/orders/:param'))).toBe(false);
    expect(shadowsByPath(at('POST', '/orders/:param'), at('GET', '/orders/latest'))).toBe(false);
    expect(shadowsByPath(at('ALL', '/orders/:param'), at('ALL', '/orders/latest'))).toBe(false);
    expect(shadowsByPath(at('GET', '/orders/*'), at('GET', '/orders/latest'))).toBe(false);
  });

  it('never holds for two routes alike, of other lengths, or a parameter that may refuse the segment', () => {
    expect(shadowsByPath(at('GET', '/orders/:param'), at('GET', '/orders/:param'))).toBe(false);
    expect(shadowsByPath(at('GET', '/orders/:param'), at('GET', '/orders/latest/items'))).toBe(false);
    expect(shadowsByPath(at('GET', '/orders/:param', { meta: { rawPath: '/orders/:id(\\d+)' } }), at('GET', '/orders/latest'))).toBe(false);
    expect(shadowsByPath(at('GET', '/orders/:param', { meta: { rawPath: '/orders/v:id' } }), at('GET', '/orders/latest'))).toBe(false);
  });
});

describe('registeredFirst (P385)', () => {
  it('orders one controller by its lines', () => {
    expect(registeredFirst(at('GET', '/a', { line: 3 }), at('GET', '/b', { line: 9 }))).toBe('a');
    expect(registeredFirst(at('GET', '/a', { line: 9 }), at('GET', '/b', { line: 3 }))).toBe('b');
  });

  it('orders two controllers by their place, and says unread without one', () => {
    const exports = { file: 'src/exports.controller.ts', meta: { controller: 'ExportsController' } };
    expect(registeredFirst(at('GET', '/a', { meta: { controllerOrder: 0 } }), at('GET', '/b', { ...exports, meta: { ...exports.meta, controllerOrder: 1 } }))).toBe('a');
    expect(registeredFirst(at('GET', '/a'), at('GET', '/b', exports))).toBe('unread');
  });

  it('orders one receiver of one file by its lines, and leaves two files unread', () => {
    const express = (file: string, registration: string, line: number) => at('GET', '/x', { file, line, meta: { adapter: 'express-routes', controller: undefined, registration } });
    expect(registeredFirst(express('src/a.ts', 'router.get', 1), express('src/a.ts', 'router.post', 2))).toBe('a');
    expect(registeredFirst(express('src/a.ts', 'router.get', 1), express('src/b.ts', 'router.get', 2))).toBe('unread');
    expect(registeredFirst(express('src/a.ts', 'router.get', 1), express('src/a.ts', 'admin.get', 2))).toBe('unread');
  });

  it('keeps apart other services, other applications, other readers and routers that rank', () => {
    expect(registeredFirst(at('GET', '/a'), at('GET', '/b', { repo: 'billing' }))).toBe('apart');
    expect(registeredFirst(at('GET', '/a', { meta: { application: 'Api' } }), at('GET', '/b', { meta: { application: 'Worker' } }))).toBe('apart');
    expect(registeredFirst(at('GET', '/a'), at('GET', '/b', { meta: { adapter: 'express-routes' } }))).toBe('apart');
    expect(registeredFirst(at('GET', '/a', { meta: { routeOrder: 'specificity' } }), at('GET', '/b', { line: 2, meta: { routeOrder: 'specificity' } }))).toBe('apart');
    expect(registeredFirst(at('GET', '/a', { meta: { routeOrder: 'unread' } }), at('GET', '/b', { line: 2, meta: { routeOrder: 'unread' } }))).toBe('unread');
  });

  it('names a router by its controller or its receiver', () => {
    expect(routerOf(at('GET', '/a'))).toBe('OrdersController');
    expect(routerOf({ file: 'src/a.ts', meta: { registration: 'itemsRouter.get' } })).toBe('itemsRouter');
  });
});
