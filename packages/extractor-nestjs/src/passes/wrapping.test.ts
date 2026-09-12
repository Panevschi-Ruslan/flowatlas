import { describe, expect, it } from 'vitest';
import type { EntryRecord, MiddlewareRoute } from '../wrapping/types.js';
import { pathMatches, routeMatches } from './wrapping.js';

const entry = (over: Partial<EntryRecord> = {}): EntryRecord =>
  ({
    node: { id: 'e', type: 'entry', label: 'e', repo: 'r', kind: 'http' },
    kind: 'http',
    path: '/orders',
    routePath: '/orders',
    httpMethod: 'GET',
    ...over,
  }) as EntryRecord;

describe('pathMatches', () => {
  it('covers the path itself and everything under it', () => {
    expect(pathMatches('/orders', '/orders')).toBe(true);
    expect(pathMatches('/orders', '/orders/:param')).toBe(true);
    expect(pathMatches('/orders', '/orders/:param/items')).toBe(true);
  });

  it('does not cover a sibling whose name merely starts the same', () => {
    expect(pathMatches('/orders', '/orders-archive')).toBe(false);
  });

  it('treats a trailing wildcard as everything below', () => {
    expect(pathMatches('/admin/*', '/admin')).toBe(true);
    expect(pathMatches('/admin/*', '/admin/stats')).toBe(true);
    expect(pathMatches('/admin/*', '/orders')).toBe(false);
  });

  it('treats a bare wildcard and the root as everything', () => {
    expect(pathMatches('/*', '/anything')).toBe(true);
    expect(pathMatches('*', '/anything')).toBe(true);
    expect(pathMatches('/', '/anything')).toBe(true);
  });

  it('matches nothing when there is no path to match', () => {
    expect(pathMatches('/orders', undefined)).toBe(false);
  });
});

describe('routeMatches', () => {
  it('matches on the path when only a path is given', () => {
    expect(routeMatches({ path: '/orders' }, entry())).toBe(true);
    expect(routeMatches({ path: '/admin' }, entry())).toBe(false);
  });

  it('filters by HTTP method when one is given', () => {
    const route: MiddlewareRoute = { path: '/orders', method: 'POST' };
    expect(routeMatches(route, entry({ httpMethod: 'POST' }))).toBe(true);
    expect(routeMatches(route, entry({ httpMethod: 'GET' }))).toBe(false);
  });

  it('treats ALL on either side as every method', () => {
    expect(routeMatches({ path: '/orders', method: 'ALL' }, entry({ httpMethod: 'GET' }))).toBe(true);
    expect(routeMatches({ path: '/orders', method: 'POST' }, entry({ httpMethod: 'ALL' }))).toBe(true);
  });

  it('matches every route of a controller when one is named', () => {
    const controller = { name: 'OrdersController' } as never;
    expect(routeMatches({ controller }, entry({ handlerClass: controller }))).toBe(true);
    expect(routeMatches({ controller }, entry({ handlerClass: undefined }))).toBe(false);
  });

  it('matches everything when the route has no filter at all', () => {
    expect(routeMatches({}, entry())).toBe(true);
  });

  it('prefers the path as written on the controller over the prefixed one', () => {
    expect(routeMatches({ path: '/orders' }, entry({ path: '/api/orders', routePath: '/orders' }))).toBe(
      true,
    );
  });
});
