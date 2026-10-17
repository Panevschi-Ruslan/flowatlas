import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { indexGraph, matchSpans } from './match.js';
import type { ObservedSpan } from './span.js';

/*
 * The edge cases of P107 §10, each on the smallest map that shows it. The
 * whole path, reader to file, is shown over `fixtures/lambda-traces` in
 * `observe.test.ts`.
 */

const AT = '2026-01-01T00:00:00.000Z';

const invoke = (service: string, name: string): GraphNode => ({
  id: `entry:${service}:invoke:${name}`,
  type: 'entry',
  kind: 'invoke',
  label: name,
  repo: service,
  meta: { key: name },
});
const handler = (service: string, file: string): GraphNode => ({ id: `${service}#${file}:handler`, type: 'function', label: 'handler', repo: service });
const producer = (service: string, at: string, label: string): GraphNode => ({
  id: `producer:${service}#${at}`,
  type: 'producer',
  label,
  repo: service,
});
const channel = (label: string): GraphNode => ({ id: `channel:${label}`, type: 'channel', label, repo: 'shop' });
const table = (name: string): GraphNode => ({ id: `table:shop#${name}`, type: 'table', label: name, repo: 'shop' });
const edge = (from: string, type: string, to: string): GraphEdge => ({ from, to, type, confidence: 'static' } as GraphEdge);

const span = (spanId: string, fields: Partial<ObservedSpan>): ObservedSpan => ({ traceId: 't', spanId, kind: 'client', at: AT, ...fields });
const sdk = (spanId: string, service: string, method: string, fields: Partial<ObservedSpan> = {}): ObservedSpan =>
  span(spanId, { rpc: `${service}/${method}`, awsOp: method, parentId: 'fn', ...fields });
const fn = (faas: string, fields: Partial<ObservedSpan> = {}): ObservedSpan => span('fn', { kind: 'server', faas, service: faas, ...fields });

const rows = (observed: ReturnType<typeof matchSpans>) => observed.unmatched.map(({ kind, name, count }) => ({ kind, name, count }));

describe('a function', () => {
  it('with no invoke entry is a function row', () => {
    const observed = matchSpans(indexGraph([invoke('shop', 'checkout')], []), [fn('refund')]);
    expect(rows(observed)).toEqual([{ kind: 'function', name: 'refund', count: 1 }]);
  });

  it('deployed under one name by two services is counted on neither (P85)', () => {
    const observed = matchSpans(indexGraph([invoke('shop', 'checkout'), invoke('outlet', 'checkout')], []), [fn('checkout')]);
    expect(observed.entries).toEqual({});
    expect(observed.ambiguous).toEqual([
      { service: 'checkout', kind: 'entry', name: 'checkout', candidates: ['entry:outlet:invoke:checkout', 'entry:shop:invoke:checkout'], count: 1 },
    ]);
  });

  it('whose name was not read is never matched by name', () => {
    const unread: GraphNode = { ...invoke('shop', '${…}@infra/main.tf:3'), meta: { key: '${…}@infra/main.tf:3' } };
    expect(rows(matchSpans(indexGraph([unread], []), [fn('${…}@infra/main.tf:3')]))).toEqual([
      { kind: 'function', name: '${…}@infra/main.tf:3', count: 1 },
    ]);
  });

  it('behind a route with no API Gateway entry: the function is matched, the route is not', () => {
    const observed = matchSpans(indexGraph([invoke('shop', 'checkout')], []), [
      fn('checkout', { trigger: 'http', method: 'POST', route: '/checkout' }),
    ]);
    expect(observed.entries['entry:shop:invoke:checkout']?.hits).toBe(1);
    expect(rows(observed)).toEqual([{ kind: 'http', name: 'POST /checkout', count: 1 }]);
  });
});

describe('a table call', () => {
  const nodes = [invoke('shop', 'archive'), handler('shop', 'src/archive.ts'), table('orders'), table('audit')];
  const edges = [edge('entry:shop:invoke:archive', 'handles', 'shop#src/archive.ts:handler')];

  it('naming two tables credits each', () => {
    const observed = matchSpans(indexGraph(nodes, edges), [fn('archive'), sdk('w', 'DynamoDB', 'BatchWriteItem', { tables: ['orders', 'audit'] })]);
    expect(observed.symbols).toMatchObject({ 'table:shop#orders': { hits: 1 }, 'table:shop#audit': { hits: 1 } });
    expect(rows(observed)).toEqual([]);
  });

  it('naming a table nothing in the map names is a table row', () => {
    const observed = matchSpans(indexGraph(nodes, edges), [fn('archive'), sdk('r', 'DynamoDB', 'GetItem', { tables: ['carts'] })]);
    expect(rows(observed)).toEqual([{ kind: 'table', name: 'carts', count: 1 }]);
  });

  it('to a service nothing here reads is counted by service and method only', () => {
    const observed = matchSpans(indexGraph(nodes, edges), [fn('archive'), sdk('s', 'SecretsManager', 'GetSecretValue')]);
    expect(rows(observed)).toEqual([{ kind: 'cloud', name: 'SecretsManager/GetSecretValue', count: 1 }]);
  });
});

describe('a send', () => {
  const nodes = [
    invoke('shop', 'checkout'),
    invoke('shop', 'refund'),
    handler('shop', 'src/checkout.ts'),
    handler('shop', 'src/refund.ts'),
    producer('shop', 'src/checkout.ts:3:1', 'message sqs/orders'),
    producer('shop', 'src/refund.ts:3:1', 'message sqs/orders'),
    producer('shop', 'src/checkout.ts:9:1', 'event placed'),
    producer('shop', 'src/refund.ts:9:1', 'event refunded'),
    channel('sqs/orders'),
    channel('eventbridge/shop/shop.orders/OrderPlaced'),
    channel('eventbridge/shop/shop.orders/OrderRefunded'),
    channel('eventbridge/default/shop.orders/OrderPlaced'),
  ];
  const edges = [
    edge('entry:shop:invoke:checkout', 'handles', 'shop#src/checkout.ts:handler'),
    edge('entry:shop:invoke:refund', 'handles', 'shop#src/refund.ts:handler'),
    edge('shop#src/checkout.ts:handler', 'calls', 'producer:shop#src/checkout.ts:3:1'),
    edge('shop#src/refund.ts:handler', 'calls', 'producer:shop#src/refund.ts:3:1'),
    edge('shop#src/checkout.ts:handler', 'calls', 'producer:shop#src/checkout.ts:9:1'),
    edge('producer:shop#src/checkout.ts:3:1', 'emits', 'channel:sqs/orders'),
    edge('producer:shop#src/refund.ts:3:1', 'emits', 'channel:sqs/orders'),
    edge('producer:shop#src/checkout.ts:9:1', 'emits', 'channel:eventbridge/shop/shop.orders/OrderPlaced'),
    edge('producer:shop#src/refund.ts:9:1', 'emits', 'channel:eventbridge/shop/shop.orders/OrderRefunded'),
  ];
  const index = indexGraph(nodes, edges);

  it('is the join from the function it ran in, of two onto one queue', () => {
    const observed = matchSpans(index, [fn('checkout'), sdk('q', 'SQS', 'SendMessage', { kind: 'producer', destination: 'orders', transport: 'sqs' })]);
    expect(Object.keys(observed.joins)).toEqual(['producer:shop#src/checkout.ts:3:1 -emits-> channel:sqs/orders']);
    expect(observed.channels['channel:sqs/orders']?.hits).toBe(1);
  });

  it('onto a queue the map does not have is a messaging row, spelled as the map would', () => {
    const observed = matchSpans(index, [fn('checkout'), sdk('q', 'SQS', 'SendMessage', { kind: 'producer', destination: 'returns', transport: 'sqs' })]);
    expect(rows(observed)).toEqual([{ kind: 'messaging', name: 'sqs/returns', count: 1 }]);
  });

  it("onto a bus with one channel is that channel's", () => {
    const observed = matchSpans(index, [fn('checkout'), sdk('e', 'EventBridge', 'PutEvents', { destination: 'default', transport: 'eventbridge' })]);
    expect(observed.channels).toEqual({ 'channel:eventbridge/default/shop.orders/OrderPlaced': expect.objectContaining({ hits: 1 }) });
  });

  it("onto a bus with several is the one the caller's code puts on, or none", () => {
    const own = matchSpans(index, [fn('checkout'), sdk('e', 'EventBridge', 'PutEvents', { destination: 'shop', transport: 'eventbridge' })]);
    expect(Object.keys(own.joins)).toEqual(['producer:shop#src/checkout.ts:9:1 -emits-> channel:eventbridge/shop/shop.orders/OrderPlaced']);
    // A function whose code puts nothing on the bus could have put either event.
    const unsure = matchSpans(index, [fn('archive'), sdk('e', 'EventBridge', 'PutEvents', { destination: 'shop', transport: 'eventbridge' })]);
    expect(unsure.channels).toEqual({});
    expect(unsure.ambiguous).toEqual([
      expect.objectContaining({
        kind: 'channel',
        name: 'eventbridge/shop',
        candidates: ['channel:eventbridge/shop/shop.orders/OrderPlaced', 'channel:eventbridge/shop/shop.orders/OrderRefunded'],
      }),
    ]);
  });

  it('that only reads, receives or describes is credited to nothing and missed by nothing', () => {
    const observed = matchSpans(index, [fn('checkout'), sdk('q', 'SQS', 'ReceiveMessage', { destination: 'returns', transport: 'sqs' })]);
    expect(observed.channels).toEqual({});
    expect(rows(observed)).toEqual([]);
  });

  it('as an SDK call over HTTP is not also an http call of the code', () => {
    const observed = matchSpans(index, [
      fn('checkout'),
      sdk('q', 'SQS', 'SendMessage', { kind: 'producer', destination: 'orders', transport: 'sqs', method: 'POST', path: '/' }),
    ]);
    expect(rows(observed)).toEqual([]);
  });
});
