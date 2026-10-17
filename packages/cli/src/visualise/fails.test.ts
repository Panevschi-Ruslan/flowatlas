import type { GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { failsByEntry } from './graph.js';
import { failuresByEntry, packFails } from './fails.js';
import { packGraph, type PackedGraph } from './pack.js';

const guard = { status: 401, exception: 'UnauthorizedException', at: 'api#src/key.guard.ts:KeyGuard', file: 'src/key.guard.ts', line: 7, source: 'guard' };

const nodes: GraphNode[] = [
  {
    id: 'entry:api:http:GET:/orders/:param',
    type: 'entry',
    kind: 'http',
    label: 'GET /orders/:param',
    repo: 'api',
    meta: {
      fails: [
        { status: 404, exception: 'NotFoundException', at: 'api#src/orders.service.ts:OrdersService.findOne', file: 'src/orders.service.ts', line: 9, source: 'throw' },
        { exception: 'RpcException', at: 'api#src/stock.ts:check', source: 'throw' },
        guard,
      ],
    },
  },
  { id: 'api#src/orders.service.ts:OrdersService.findOne', type: 'method', label: 'OrdersService.findOne', repo: 'api', file: 'src/orders.service.ts' },
  { id: 'entry:api:http:GET:/health', type: 'entry', kind: 'http', label: 'GET /health', repo: 'api' },
  { id: 'entry:api:http:GET:/carts', type: 'entry', kind: 'http', label: 'GET /carts', repo: 'api', meta: { fails: [guard] } },
  { id: 'api#src/key.guard.ts:KeyGuard', type: 'provider', kind: 'guard', label: 'KeyGuard', repo: 'api', file: 'src/key.guard.ts' },
];

const report = {
  httpOut: {},
  channels: {},
  routes: { total: 0, called: 0, duplicated: 0 },
  types: {},
  totals: {},
  services: [],
} as never;

const pack = (list: GraphNode[] = nodes): PackedGraph =>
  packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes: list, edges: [], unresolved: [], report });

describe('packing what each way in can fail with (P68, P84)', () => {
  it('ships each failure once, and two ways in behind one guard point at one record', () => {
    const data = pack();
    expect(data.dicts.fails).toHaveLength(3);
    const [first, second] = [data.fails?.[0], data.fails?.[3]];
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(1);
    expect(first).toContain(second![0]);
  });

  it('expands back to the objects every reader saw before, for both ways in', () => {
    const fails = failsByEntry(pack());
    expect(fails.get(0)).toEqual([
      { s: 404, x: 'NotFoundException', at: 1, f: 'src/orders.service.ts', l: 9, src: 'throw' },
      { x: 'RpcException', at: -1, id: 'api#src/stock.ts:check', src: 'throw' },
      { s: 401, x: 'UnauthorizedException', at: 4, f: 'src/key.guard.ts', l: 7, src: 'guard' },
    ]);
    expect(fails.get(3)).toEqual([{ s: 401, x: 'UnauthorizedException', at: 4, f: 'src/key.guard.ts', l: 7, src: 'guard' }]);
    // One object, shared: the guard is expanded once however many routes it stands in front of.
    expect(fails.get(3)![0]).toBe(fails.get(0)![2]);
    expect(fails.has(2)).toBe(false);
  });

  it('holds a failure file the nodes do not name in the page\'s file dictionary', () => {
    const data = pack([{ ...nodes[0]!, meta: { fails: [{ ...guard, file: 'src/elsewhere.ts' }] } }]);
    expect(data.dicts.files).toContain('src/elsewhere.ts');
    expect(failsByEntry(data).get(0)![0]!.f).toBe('src/elsewhere.ts');
  });

  it('lists a word only when listing it pays, and ships the rest as they are', () => {
    const position = new Map(nodes.map((node, index) => [node.id, index]));
    const fileIx = new Map([['src/orders.service.ts', 0], ['src/key.guard.ts', 1]]);
    const packed = packFails(failuresByEntry(nodes), position, fileIx)!;
    // Three distinct records, each exception once: nothing worth a list.
    expect(packed.tables.exceptions).toBeUndefined();
    expect(new Set(packed.tables.fails.map((record) => record[1]))).toEqual(
      new Set(['NotFoundException', 'RpcException', 'UnauthorizedException']),
    );
  });

  it('ships an assumed status negated, and expands it to `a` (P87)', () => {
    const plain = { status: 500, exception: 'Error', at: 'api#src/stock.ts:check', source: 'throw' };
    const data = pack([{ ...nodes[0]!, meta: { fails: [{ ...plain, assumed: true }, { ...plain, line: 3 }] } }]);
    expect(data.dicts.fails?.map((record) => record[0]).sort()).toEqual([-500, 500]);
    expect(failsByEntry(data).get(0)!.map((fail) => [fail.s, fail.a])).toEqual([
      [500, 1],
      [500, undefined],
    ]);
  });

  it('ships nothing when no entry says', () => {
    expect(packFails(failuresByEntry(nodes.slice(1, 3)), new Map(), new Map())).toBeUndefined();
    const data = pack(nodes.slice(1, 3));
    expect(data.fails).toBeUndefined();
    expect(data.dicts.fails).toBeUndefined();
    expect(failsByEntry(data).size).toBe(0);
  });
});
