import { describe, expect, it } from 'vitest';
import { shadowsByPath, type OrderedRoute } from './route-order.js';

const at = (method: string, path: string, extra: Partial<OrderedRoute> & { meta?: Record<string, unknown> } = {}): OrderedRoute => ({
  repo: 'shop',
  file: 'src/orders.controller.ts',
  line: 1,
  ...extra,
  meta: { method, path, adapter: 'ordered-routes', controller: 'OrdersController', ...extra.meta },
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
