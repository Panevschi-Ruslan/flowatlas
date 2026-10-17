import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { edgeIdOf, indexGraph, matchSpans } from './match.js';
import type { ObservedSpan } from './span.js';

const call = (id: string, path: string): GraphNode => ({
  id,
  type: 'http_out',
  label: `GET ${path}`,
  repo: 'shop',
  meta: { method: 'GET', path },
});
const route = (id: string, path: string): GraphNode => ({
  id,
  type: 'entry',
  kind: 'http',
  label: `GET ${path}`,
  repo: 'catalog',
  meta: { method: 'GET', path },
});
const method = (file: string, name: string): GraphNode => ({
  id: `shop#${file}:${name}`,
  type: 'method',
  label: name,
  repo: 'shop',
});
const joined = (from: string, to: string): GraphEdge => ({ from, to, type: 'http_calls', confidence: 'static' });

const PRODUCT = 'entry:catalog:http:GET:/products/:param';
const ONE = 'http_out:shop#src/a.ts:1:1';
const TWO = 'http_out:shop#src/b.ts:2:1';

const server = (path: string, parent?: string): ObservedSpan => ({
  traceId: 't',
  spanId: 'server',
  kind: 'server',
  service: 'catalog',
  method: 'GET',
  path,
  at: '2026-01-01T00:00:00.000Z',
  ...(parent === undefined ? {} : { parentId: parent }),
});
const caller = (kind: 'client' | 'internal', path?: string): ObservedSpan => ({
  traceId: 't',
  spanId: 'caller',
  kind,
  service: 'shop',
  ...(path === undefined ? {} : { method: 'GET', path }),
});

describe('a request counts once', () => {
  it('credits no join from a caller with two calls into the entry, and says it could be either', () => {
    const graph = indexGraph(
      [call(ONE, '/products/:id'), call(TWO, '/products/:id/x'), route(PRODUCT, '/products/:id')],
      [joined(ONE, PRODUCT), joined(TWO, PRODUCT)],
    );
    const observed = matchSpans(graph, [caller('internal'), server('/products/:value', 'caller')]);
    expect(observed.joins).toEqual({});
    expect(observed.entries[PRODUCT]?.hits).toBe(1);
    expect(observed.ambiguous).toEqual([
      {
        service: 'catalog',
        kind: 'join',
        name: 'GET /products/:value',
        candidates: [edgeIdOf(joined(ONE, PRODUCT)), edgeIdOf(joined(TWO, PRODUCT))],
        count: 1,
      },
    ]);
  });

  it('credits the one join from a caller with one call into the entry', () => {
    const graph = indexGraph([call(ONE, '/products/:id'), route(PRODUCT, '/products/:id')], [joined(ONE, PRODUCT)]);
    const observed = matchSpans(graph, [caller('internal'), server('/products/:value', 'caller')]);
    expect(observed.joins[edgeIdOf(joined(ONE, PRODUCT))]).toEqual({ count: 1, lastSeen: '2026-01-01T00:00:00.000Z' });
    expect(observed.ambiguous).toEqual([]);
  });

  it('credits the join the client span names when the caller has two', () => {
    const graph = indexGraph(
      [call(ONE, '/products/:id'), call(TWO, '/products/:id/x'), route(PRODUCT, '/products/:id')],
      [joined(ONE, PRODUCT), joined(TWO, PRODUCT)],
    );
    const observed = matchSpans(graph, [caller('client', '/products/p1'), server('/products/:value', 'caller')]);
    expect(Object.keys(observed.joins)).toEqual([edgeIdOf(joined(ONE, PRODUCT))]);
    expect(observed.symbols).toEqual({ [ONE]: { hits: 1 } });
    expect(observed.ambiguous).toEqual([]);
  });

  it('credits no route when two tie for a path', () => {
    const graph = indexGraph(
      [route('entry:catalog:http:GET:/items/:id', '/items/:id'), route('entry:catalog:http:GET:/items/:slug', '/items/:slug')],
      [],
    );
    const observed = matchSpans(graph, [server('/items/:value')]);
    expect(observed.entries).toEqual({});
    expect(observed.ambiguous).toEqual([
      {
        service: 'catalog',
        kind: 'entry',
        name: 'GET /items/:value',
        candidates: ['entry:catalog:http:GET:/items/:id', 'entry:catalog:http:GET:/items/:slug'],
        count: 1,
      },
    ]);
  });

  it('settles a route tie by the one join the caller names', () => {
    const slug = 'entry:catalog:http:GET:/products/:slug';
    const graph = indexGraph(
      [call(ONE, '/products/:id'), route(PRODUCT, '/products/:id'), route(slug, '/products/:slug')],
      [joined(ONE, PRODUCT)],
    );
    const observed = matchSpans(graph, [caller('client', '/products/p1'), server('/products/:value', 'caller')]);
    expect(observed.entries).toEqual({ [PRODUCT]: { hits: 1, lastSeen: '2026-01-01T00:00:00.000Z' } });
    expect(Object.keys(observed.joins)).toEqual([edgeIdOf(joined(ONE, PRODUCT))]);
  });

  it('credits no method when two of one name are in the service', () => {
    const graph = indexGraph([method('src/a.ts', 'CartService.add'), method('src/b.ts', 'CartService.add')], []);
    const span: ObservedSpan = { traceId: 't', spanId: 's', kind: 'internal', service: 'shop', symbol: 'CartService.add' };
    const observed = matchSpans(graph, [span, { ...span, spanId: 's2' }]);
    expect(observed.symbols).toEqual({});
    expect(observed.ambiguous).toEqual([
      {
        service: 'shop',
        kind: 'symbol',
        name: 'CartService.add',
        candidates: ['shop#src/a.ts:CartService.add', 'shop#src/b.ts:CartService.add'],
        count: 2,
      },
    ]);
  });

  it('credits the join a client call names on its own, and none when two calls fit it', () => {
    const one = indexGraph([call(ONE, '/products/:id'), route(PRODUCT, '/products/:id')], [joined(ONE, PRODUCT)]);
    const alone = matchSpans(one, [caller('client', '/products/p1')]);
    expect(Object.keys(alone.joins)).toEqual([edgeIdOf(joined(ONE, PRODUCT))]);
    expect(alone.symbols).toEqual({ [ONE]: { hits: 1 } });

    const two = indexGraph(
      [call(ONE, '/products/:id'), call(TWO, '/products/:key'), route(PRODUCT, '/products/:id')],
      [joined(ONE, PRODUCT)],
    );
    const tied = matchSpans(two, [caller('client', '/products/p1')]);
    expect(tied.joins).toEqual({});
    expect(tied.symbols).toEqual({});
    expect(tied.ambiguous).toEqual([
      { service: 'shop', kind: 'client', name: 'GET /products/p1', candidates: [ONE, TWO], count: 1 },
    ]);
  });

  it('names at most five candidates and counts the rest', () => {
    const nodes = [1, 2, 3, 4, 5, 6, 7].map((n) => method(`src/${n}.ts`, 'CartService.add'));
    const observed = matchSpans(indexGraph(nodes, []), [
      { traceId: 't', spanId: 's', kind: 'internal', service: 'shop', symbol: 'CartService.add' },
    ]);
    expect(observed.ambiguous[0]!.candidates).toHaveLength(5);
    expect(observed.ambiguous[0]!.more).toBe(2);
  });
});
