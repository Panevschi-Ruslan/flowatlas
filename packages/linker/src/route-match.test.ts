import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { isMatch, matchRoute, pathAnswers } from './route-match.js';

const route = (method: string, path: string, controller = 'C'): GraphNode => ({
  id: `entry:orders:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo: 'orders',
  meta: { method, path, controller },
});

describe('pathAnswers', () => {
  it('accepts any single segment where the route has a hole', () => {
    expect(pathAnswers('/orders/:param/items', '/orders/123/items')).toBe(true);
  });

  it('refuses a literal the request does not spell the same way', () => {
    expect(pathAnswers('/orders/latest', '/orders/123')).toBe(false);
  });

  it('refuses a hole in the request where the route wants a literal', () => {
    expect(pathAnswers('/orders/latest', '/orders/:param')).toBe(false);
  });

  it('refuses a request with segments left over', () => {
    expect(pathAnswers('/orders/:param', '/orders/123/items')).toBe(false);
  });

  it('refuses a request that runs out of segments', () => {
    expect(pathAnswers('/orders/:param/items', '/orders/123')).toBe(false);
  });

  it('lets a wildcard take everything below it', () => {
    expect(pathAnswers('/files/*', '/files/a/b/c')).toBe(true);
  });

  it('ignores trailing and doubled slashes on either side', () => {
    expect(pathAnswers('/orders/', '//orders')).toBe(true);
  });

  it('refuses a request holding a span nobody could read', () => {
    // The route's own hole is one it declares and any single segment fills.
    // This is a hole in what was read, and it may not even be one segment.
    expect(pathAnswers('/orders/:param/items', '/orders/${…}/items')).toBe(false);
    expect(pathAnswers('/orders/:param', '/${…}')).toBe(false);
  });

  it('refuses a route whose own path could not be read', () => {
    expect(pathAnswers('/orders/${…}', '/orders/42')).toBe(false);
  });

  it('keeps reading a route after a wildcard that is not the last thing in it', () => {
    // The wildcard used to answer yes on sight, wherever it stood, and the rest
    // of the route was never looked at: this pair matched, and the edge claimed
    // one service reaches another through an address it does not serve.
    expect(pathAnswers('/files/*/download', '/files/a/anything')).toBe(false);
    expect(pathAnswers('/files/*/download', '/files/a/download')).toBe(true);
  });

  it('wants at least one segment under a trailing wildcard', () => {
    expect(pathAnswers('/api/*', '/api/orders/42')).toBe(true);
    expect(pathAnswers('/api/*', '/api')).toBe(false);
  });

  it('reads a literal without regard to case, as the routers it reads do', () => {
    // Express and Nest both answer `/Orders/42` from `/orders/:id`. Comparing
    // exactly reported that as a route the target does not serve — a finding
    // about a disagreement that was not there.
    expect(pathAnswers('/orders/:param', '/Orders/42')).toBe(true);
    expect(pathAnswers('/ORDERS/latest', '/orders/latest')).toBe(true);
    expect(pathAnswers('/orders/latest', '/orders/newest')).toBe(false);
  });

  it('answers nothing when either side has no path at all', () => {
    expect(pathAnswers('', '')).toBe(false);
    expect(pathAnswers('', '/orders')).toBe(false);
    expect(pathAnswers('/orders', '')).toBe(false);
  });
});

describe('matchRoute', () => {
  it('reads the verb declared by a route without regard to case', () => {
    // Only the asked-for verb was raised, so a route that recorded its own in
    // any other case answered nothing at all rather than saying why.
    expect(isMatch(matchRoute('GET', '/x', [route('get', '/x')]))).toBe(true);
  });

  const entries = [route('GET', '/orders/:param'), route('POST', '/orders')];

  it('finds the route that answers', () => {
    const found = matchRoute('GET', '/orders/42', entries);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/orders/:param');
  });

  it('does not care how the verb is spelled', () => {
    expect(isMatch(matchRoute('get', '/orders/42', entries))).toBe(true);
  });

  it('prefers the literal route over the one with a hole', () => {
    const withLiteral = [...entries, route('GET', '/orders/latest')];
    const found = matchRoute('GET', '/orders/latest', withLiteral);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/orders/latest');
  });

  it('answers any verb from a route registered for all of them', () => {
    const all = [route('ALL', '/webhook')];
    expect(isMatch(matchRoute('PATCH', '/webhook', all))).toBe(true);
  });

  it('reports nothing found when only the verb is wrong', () => {
    const found = matchRoute('DELETE', '/orders/42', entries);
    expect(isMatch(found)).toBe(false);
    expect(!isMatch(found) && found.reason).toBe('not-found');
  });

  it('refuses to choose when two differently spelled routes both answer', () => {
    const overlapping = [route('GET', '/a/:param/x'), route('GET', '/a/x/:param')];
    const found = matchRoute('GET', '/a/x/x', overlapping);
    expect(!isMatch(found) && found.reason).toBe('ambiguous');
    expect(!isMatch(found) && found.candidates).toEqual([
      'entry:orders:http:GET:/a/:param/x',
      'entry:orders:http:GET:/a/x/:param',
    ]);
  });

  it('prefers a route with a hole in it to a catch-all with as many', () => {
    // R15. A worker hands everything under `/api` to the application behind it,
    // so `ALL /api/*` answers every address that application serves. Counting
    // holes made those a tie and every request to the service ambiguous.
    const bridged = [route('ALL', '/api/*'), route('GET', '/api/orders/:param')];
    const found = matchRoute('GET', '/api/orders/42', bridged);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:GET:/api/orders/:param');
    // And the catch-all is not named as a runner-up: no router hesitates
    // between a route and a wildcard, so there is nothing to warn about.
    expect(isMatch(found) && found.runnersUp).toEqual([]);
  });

  it('prefers the catch-all that spells out more of the address', () => {
    const nested = [route('ALL', '/api/*'), route('ALL', '/api/admin/*')];
    const found = matchRoute('GET', '/api/admin/reports', nested);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:ALL:/api/admin/*');
  });

  it('still answers with the catch-all when nothing spells the address out', () => {
    const bridged = [route('ALL', '/api/*'), route('GET', '/api/orders/:param')];
    const found = matchRoute('GET', '/api/nothing/serves/this', bridged);
    expect(isMatch(found) && found.entry.id).toBe('entry:orders:http:ALL:/api/*');
  });

  it('ignores nodes that are not http routes', () => {
    const consumer: GraphNode = {
      id: 'entry:orders:message:order.created',
      type: 'entry',
      kind: 'message',
      label: 'order.created',
      repo: 'orders',
      meta: { method: 'GET', path: '/orders/42' },
    };
    expect(isMatch(matchRoute('GET', '/orders/42', [consumer]))).toBe(false);
  });
});
