import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, DiffReport, LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { packBusiest } from './busiest.js';
import { packChanges, placeOfId } from './changes.js';
import { createModel, findEverything, type GraphModel } from './graph.js';
import { packGraph, type PackedGraph } from './pack.js';
import { promptFor, stepBreakOf, stepsOf } from './steps.js';

/**
 * A synthetic shop for P73's views: a gateway route calls a client whose
 * outbound call finds no route on the orders side, a route with no handler,
 * a channel nobody consumes, and an orders route a client calls from two
 * gateway routes.
 */
const report = {
  httpOut: {}, channels: {}, routes: { total: 0, called: 0, duplicated: 0 }, types: {}, totals: {},
  services: [{ name: 'shop-gateway', type: 'nestjs' }, { name: 'shop-orders', type: 'nestjs' }],
} as unknown as LinkReport;

const n = (id: string, type: GraphNode['type'], repo: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, repo, label: extra.label ?? id, file: 'src/a.ts', line: 1, ...extra,
});
const nodes: GraphNode[] = [
  n('entry:shop-gateway:http:POST:/carts/:param/void', 'entry', 'shop-gateway', { kind: 'http', label: 'POST /carts/:param/void' }),
  n('shop-gateway#CartsController.void', 'method', 'shop-gateway', { label: 'CartsController.void' }),
  n('shop-gateway#CartsClient.void', 'method', 'shop-gateway', { label: 'CartsClient.void' }),
  n('http_out:shop-gateway#src/carts.client.ts:9:3', 'http_out', 'shop-gateway', {
    label: 'POST /carts/:param/void', meta: { method: 'POST', path: '/carts/:param/void' },
  }),
  n('entry:shop-gateway:http:GET:/health', 'entry', 'shop-gateway', { kind: 'http', label: 'GET /health' }),
  n('channel:cart.voided', 'channel', 'shop-orders', { label: 'cart.voided' }),
  n('entry:shop-gateway:http:GET:/carts', 'entry', 'shop-gateway', { kind: 'http', label: 'GET /carts' }),
  n('shop-gateway#CartsController.list', 'method', 'shop-gateway', { label: 'CartsController.list' }),
  n('table:shop-orders#carts', 'table', 'shop-orders', { label: 'carts' }),
];
const e = (from: number, to: number, type: GraphEdge['type']): GraphEdge => ({
  from: nodes[from]!.id, to: nodes[to]!.id, type, confidence: 'static',
});
const edges: GraphEdge[] = [
  e(0, 1, 'handles'),
  e(1, 2, 'calls'),
  e(2, 3, 'calls'),
  e(6, 7, 'handles'),
  e(7, 2, 'calls'),
];
const unresolved: AnchoredUnresolvedRow[] = [{
  node: nodes[3]!.id, service: 'shop-gateway', file: 'src/carts.client.ts', line: 9, reason: 'target-route-not-found',
  level: 'action', sites: 1, message: 'target service shop-orders has no route POST /carts/:param/void', hint: null,
}];

const pack = (): PackedGraph =>
  packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes, edges, unresolved, report });
const modelOf = (data: PackedGraph): GraphModel => createModel(data) as GraphModel;

describe('where a chain breaks', () => {
  it('ends a call that found no route with a red row saying so, and the check row that says why', () => {
    const model = modelOf(pack());
    const { rows } = stepsOf(model, 0);
    const last = rows[rows.length - 1]!;
    expect(rows.map((row) => row.kind)).toEqual(['handler', 'service', 'service', 'http', 'break']);
    expect(last).toMatchObject({ node: 3, depth: 4, failure: true, inline: 'no route', reason: 'target-route-not-found' });
    expect(last.message).toContain('has no route');
  });

  it('marks a way in with no handler, and a channel with nothing after it', () => {
    const model = modelOf(pack());
    expect(stepsOf(model, 4).rows.map((row) => [row.kind, row.inline])).toEqual([['handler', ''], ['break', 'no handler']]);
    expect(stepBreakOf(model, 5)).toMatchObject({ say: 'no handler' });
  });

  it('leaves a step that goes on, or ends where it should, unmarked', () => {
    const model = modelOf(pack());
    expect(stepBreakOf(model, 1)).toBeNull();
    expect(stepBreakOf(model, 8)).toBeNull();
  });

  it('says the break in a prompt', () => {
    const model = modelOf(pack());
    const text = promptFor(model, { entry: 0 }, { keyOf: String });
    expect(text).toContain('- chain breaks here: no route (target service shop-orders has no route');
  });
});

describe('one search over everything', () => {
  it('finds routes, tables and gaps by every word typed, a group at a time', () => {
    const model = modelOf(pack());
    const found = findEverything(model, 'carts');
    const keys = found.map((group) => group.key);
    expect(keys).toEqual(expect.arrayContaining(['routes', 'tables', 'gaps', 'classes']));
    const routes = found.find((group) => group.key === 'routes')!;
    expect(routes.hits.map((hit) => hit.label)).toEqual(['GET /carts', 'POST /carts/:param/void']);
    expect(found.find((group) => group.key === 'gaps')!.hits[0]).toMatchObject({ node: 3 });
    expect(found.find((group) => group.key === 'classes')!.hits.map((hit) => hit.label))
      .toEqual(['CartsClient', 'CartsController']);
    expect(findEverything(model, 'cart voided').map((group) => group.key)).toEqual(['channels']);
    expect(findEverything(model, '   ')).toEqual([]);
  });
});

describe('busiest methods', () => {
  it('ranks by edges pointing in, with the ways in that reach each one and how far', () => {
    const position = new Map(nodes.map((node, i) => [node.id, i]));
    const { rows, ranked } = packBusiest(nodes, edges, position);
    // `handles` is not a hotspot edge, so a controller method a route hands to ranks nowhere.
    expect(ranked).toBe(1);
    // CartsClient.void: two callers, both its own service's; two ways in; two steps from the nearest.
    expect(rows[0]).toEqual([2, 2, 2, 1, 2, 2]);
    expect(pack().busiest.rows[0]).toEqual(rows[0]);
  });
});

describe('changes', () => {
  const diff = {
    base: { ref: 'main', services: {} },
    head: { ref: null, services: {} },
    nodes: {
      added: ['entry:shop-orders:http:GET:/carts/today', 'shop-orders#Carts.today'],
      removed: ['entry:shop-orders:http:GET:/carts/:param', 'entry:shop-orders:http:DELETE:/carts'],
      changed: [], moved: [],
    },
    edges: {
      added: [],
      removed: [
        { from: 'http_out:shop-gateway#src/carts.client.ts:12:5', to: 'entry:shop-orders:http:GET:/carts/:param', type: 'hits' },
        { from: 'entry:shop-orders:http:DELETE:/carts', to: 'shop-orders#Carts.drop', type: 'handles' },
      ],
      changed: [],
    },
    types: {
      added: [], removed: [],
      changed: [{ id: 'type:Cart', name: 'Cart', baseHash: 'a', headHash: 'b', fieldDiff: [
        { field: 'total', change: 'type', optional: false, base: 'number', head: 'string', rule: null, message: 'total: number became string' },
      ] }],
    },
    counts: {
      base: { nodes: 10, edges: 9, types: 1, unresolved: { rows: 2, sites: 2 } },
      head: { nodes: 10, edges: 7, types: 1, unresolved: { rows: 3, sites: 3 } },
    },
    impact: [],
    contracts: { new: [{ severity: 'error', kind: 'field-type', message: 'Cart.total disagrees' }], fixed: [], preexisting: [], ignored: [] },
    warnings: [],
  } as unknown as DiffReport;

  it('lists routes added and removed, the removed ones still called, changed shapes and new gaps', () => {
    const packed = packChanges(diff);
    expect(packed.routes.added).toEqual([{ id: 'entry:shop-orders:http:GET:/carts/today', service: 'shop-orders', label: 'GET /carts/today' }]);
    expect(packed.routes.removed.map((route) => route.label)).toEqual(['GET /carts/:param', 'DELETE /carts']);
    expect(packed.stillCalled).toEqual([{
      id: 'entry:shop-orders:http:GET:/carts/:param', service: 'shop-orders', label: 'GET /carts/:param',
      callers: ['shop-gateway: src/carts.client.ts:12'],
    }]);
    expect(packed.shapes).toEqual([{ id: 'type:Cart', name: 'Cart', fields: ['total: number became string'] }]);
    expect(packed.gaps).toEqual([{ severity: 'error', kind: 'field-type', message: 'Cart.total disagrees' }]);
    expect(packed.unresolved).toEqual({ base: 2, head: 3 });
    expect(packed.base).toBe('main');
  });

  it('rides in the pack only when asked for', () => {
    expect(pack().changes).toBeUndefined();
    const changes = packChanges(diff);
    expect(packGraph({ builtAt: '', nodes, edges, unresolved, report, changes }).changes).toBe(changes);
  });

  it('reads an id as a place', () => {
    expect(placeOfId('http_out:shop-gateway#src/carts.client.ts:12:5')).toBe('shop-gateway: src/carts.client.ts:12');
    expect(placeOfId('entry:shop-orders:http:GET:/x')).toBe('entry:shop-orders:http:GET:/x');
  });
});
