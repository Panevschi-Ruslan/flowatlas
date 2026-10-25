import { mergeShapes, shapeOf, type EntryShapes, type GraphEdge, type GraphNode, type TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { lookupOf } from './lookup.js';
import { edge, field, graphOf, node, object, values } from './test-graph.js';
import { compareTraffic, TRAFFIC_MIN_SAMPLES, trafficPaths } from './traffic.js';

const ENTRY = 'entry:shop:http:POST:/orders';
const HANDLER = 'shop#OrdersController.create';
const CALL = 'ui_api_call:web#api.ts:3:1';

const types: TypeRegistry = {
  'type:shop#Money': object('Money', [field('amount', 'number'), field('currency', 'string')]),
  'type:shop#Status': values('Status', 'union', ["'paid'", "'created'"]),
  'type:shop#CreateOrder': object('CreateOrder', [
    field('customerId', 'string'),
    field('total', 'type:shop#Money'),
    field('coupon', 'string', true),
  ]),
  'type:shop#Order': object('Order', [
    field('id', 'string'),
    field('status', 'type:shop#Status'),
    field('createdAt', 'Date'),
    field('total', 'type:shop#Money'),
  ]),
  'type:web#OrderView': object('OrderView', [field('id', 'string'), field('label', 'string')]),
  'type:axios#AxiosResponse<type:shop#Order>': { name: 'AxiosResponse', kind: 'external', declaredIn: 'axios', structuralHash: 'x' },
};

const lookupWith = (handles: Partial<GraphEdge>, call: Partial<GraphEdge> = {}, extra: GraphNode[] = []) =>
  lookupOf(
    graphOf({
      nodes: [
        node(ENTRY, 'entry', 'shop', { kind: 'http' }),
        node(HANDLER, 'method', 'shop'),
        node(CALL, 'ui_api_call', 'web'),
        ...extra,
      ],
      edges: [edge(ENTRY, 'handles', HANDLER, handles), edge(CALL, 'hits', ENTRY, call)],
      types,
    }),
  );

const lookup = lookupWith({ params: ['type:shop#CreateOrder'], returns: 'type:shop#Order' });

/** Bodies as `observe --shapes` would have merged them. */
const shapesOf = (requests: unknown[], responses: Record<string, unknown[]> = {}): EntryShapes => ({
  ...(requests.length === 0 ? {} : { request: requests.map(shapeOf).reduce(mergeShapes) }),
  ...(Object.keys(responses).length === 0
    ? {}
    : { responses: Object.fromEntries(Object.entries(responses).map(([status, bodies]) => [status, bodies.map(shapeOf).reduce(mergeShapes)])) }),
  samples: Math.max(requests.length, ...Object.values(responses).map((bodies) => bodies.length)),
  lastSeen: '2025-10-16T08:00:00.000Z',
});

const order = { customerId: 'cus-1', total: { amount: 4, currency: 'EUR' } };

describe('compareTraffic (P113): requests, traffic as the sender', () => {
  it('reports a field the front end sends that the route does not declare, with how often', () => {
    const traffic = compareTraffic(ENTRY, shapesOf([{ ...order, giftNote: 'x' }, order, order]), lookup);
    expect(traffic.request?.against).toEqual({ typeId: 'type:shop#CreateOrder', by: 'route', symbol: HANDLER, service: 'shop' });
    expect(traffic.request?.diffs).toEqual([
      expect.objectContaining({ kind: 'extra_field', path: 'giftNote', actual: 'string', severity: 'info', seenIn: 1, of: 3 }),
    ]);
    expect(traffic.request?.diffs[0]?.message).toBe("requests send `giftNote: string`; the route's CreateOrder declares no such field (1 of 3)");
    expect(traffic.differs).toBe(1);
    expect(trafficPaths(traffic)).toEqual(['request giftNote']);
  });

  it('reports a required field no request carried, and one only some did, as warnings at most', () => {
    const traffic = compareTraffic(ENTRY, shapesOf([{ total: order.total }, { ...order }]), lookup);
    expect(traffic.request?.diffs.map((diff) => [diff.kind, diff.path, diff.severity, diff.seenIn, diff.of])).toEqual([
      ['optionality_mismatch', 'customerId', 'warning', 1, 2],
    ]);
    const never = compareTraffic(ENTRY, shapesOf([{ total: order.total }]), lookup);
    expect(never.request?.diffs).toEqual([
      expect.objectContaining({ kind: 'missing_required', path: 'customerId', severity: 'warning', seenIn: 0, of: 1 }),
    ]);
    expect(never.request?.diffs[0]?.message).toBe("the route's CreateOrder requires `customerId: string`; no request sent it (0 of 1)");
  });

  it('says a declared optional field never sent only past minSamples, as information', () => {
    const many = shapesOf(Array.from({ length: TRAFFIC_MIN_SAMPLES }, () => order));
    expect(compareTraffic(ENTRY, many, lookup).request?.diffs).toEqual([
      expect.objectContaining({ kind: 'declared_never_sent', path: 'coupon', severity: 'info', seenIn: 0, of: TRAFFIC_MIN_SAMPLES }),
    ]);
    expect(compareTraffic(ENTRY, many, lookup).differs).toBe(0);
    expect(compareTraffic(ENTRY, shapesOf([order]), lookup).request?.diffs).toEqual([]);
    expect(compareTraffic(ENTRY, shapesOf([order, order]), lookup, { minSamples: 2 }).request?.diffs[0]?.message).toBe(
      "`coupon` is optional in the route's CreateOrder and no request of 2 sent it",
    );
  });

  it('reports a type that differs, and leaves a route without a body type unchecked with the shape kept', () => {
    const traffic = compareTraffic(ENTRY, shapesOf([{ ...order, total: { amount: '4', currency: 'EUR' } }]), lookup);
    expect(traffic.request?.diffs).toEqual([
      expect.objectContaining({ kind: 'type_mismatch', path: 'total.amount', actual: 'string', expected: 'number', severity: 'warning' }),
    ]);
    const bare = compareTraffic(ENTRY, shapesOf([order]), lookupWith({ params: ['string'] }));
    expect(bare.request).toBeUndefined();
    expect(bare.unchecked).toEqual([{ direction: 'request', reason: 'no-declared-type', samples: 1 }]);
  });
});

describe('compareTraffic (P113): answers', () => {
  const answer = { id: 'ord-1', status: 'paid', createdAt: '2025-10-16T08:00:00.000Z', total: order.total };

  it('applies the wire rules: a Date declared and a string seen is not drift, nor a string where a set of strings is declared', () => {
    const traffic = compareTraffic(ENTRY, shapesOf([], { '201': [answer] }), lookup);
    expect(traffic.responses?.['201']?.diffs).toEqual([]);
    expect(traffic.responses?.['201']?.rulesApplied).toContain('date-string:createdAt');
    expect(traffic.responses?.['201']?.rulesApplied).toContain('traffic-values-not-kept:status');
  });

  it('reports a field answers carry that the code does not declare, and one it declares that none carried', () => {
    const { id: _id, ...noId } = answer;
    const traffic = compareTraffic(ENTRY, shapesOf([], { '201': [{ ...noId, owner: 'a@b.org' }] }), lookup);
    expect(traffic.responses?.['201']?.diffs.map((diff) => diff.message)).toEqual([
      "the route's Order declares `id: string`; no response carried it (0 of 1)",
      "responses carry `owner: string`; the route's Order declares no such field (1 of 1)",
    ]);
  });

  it('compares only 2xx answers, and against what the caller expects when the route declares nothing readable', () => {
    const wrapped = lookupWith({ params: ['type:shop#CreateOrder'], returns: 'type:axios#AxiosResponse<type:shop#Order>' }, { returns: 'type:web#OrderView' });
    const traffic = compareTraffic(ENTRY, shapesOf([], { '200': [{ id: 'x', label: 'y', extra: 1 }], '404': [{ message: 'x' }] }), wrapped);
    expect(traffic.responses?.['200']?.against).toEqual({ typeId: 'type:web#OrderView', by: 'caller', symbol: CALL, service: 'web' });
    expect(traffic.responses?.['200']?.diffs.map((diff) => diff.message)).toEqual([
      "responses carry `extra: number`; web's OrderView declares no such field (1 of 1)",
    ]);
    expect(traffic.unchecked).toEqual([{ direction: 'response', status: '404', reason: 'status-not-declared', samples: 1 }]);
    const nothing = compareTraffic(ENTRY, shapesOf([], { '200': [{ id: 'x' }] }), lookupWith({ returns: 'type:axios#AxiosResponse<type:shop#Order>' }));
    expect(nothing.unchecked).toEqual([{ direction: 'response', status: '200', reason: 'type-unreadable', samples: 1 }]);
  });

  it('never makes an error, whatever the comparator said', () => {
    const traffic = compareTraffic(ENTRY, shapesOf([{ nothing: 1 }], { '201': [{ nothing: 1 }] }), lookup);
    const all = [...(traffic.request?.diffs ?? []), ...(traffic.responses?.['201']?.diffs ?? [])];
    expect(all.length).toBeGreaterThan(3);
    expect(all.some((diff) => diff.severity === 'error')).toBe(false);
  });
});
