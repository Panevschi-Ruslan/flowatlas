import { afterAll, describe, expect, it } from 'vitest';
import { buildTestDb, entry, node, removeTestDbs } from '../test-graph.js';
import { resolveMention } from './docs.js';

afterAll(removeTestDbs);

const db = buildTestDb({
  nodes: [
    entry('entry:orders:http:POST:/orders', { label: 'POST /orders', meta: { method: 'POST', path: '/orders' } }),
    entry('entry:orders:invoke:orders-dev-nightly', { kind: 'invoke', label: 'orders-dev-nightly', meta: { key: 'orders-dev-nightly' } }),
    node('orders#src/orders.service.ts:OrdersService.create', { label: 'OrdersService.create' }),
    node('channel:order.created', { type: 'channel', label: 'order.created' }),
  ],
  edges: [],
});

const said = (text: string): string | undefined => {
  const found = resolveMention(db, text);
  return found === undefined ? undefined : 'node' in found ? found.node.id : `dead${found.near.length > 0 ? `, near ${found.near[0]}` : ''}`;
};

describe('what a page names (P234)', () => {
  it('links a route said aloud, a channel, a deployed name and a dotted label that is one node', () => {
    expect(said('POST /orders')).toBe('entry:orders:http:POST:/orders');
    expect(said('order.created')).toBe('channel:order.created');
    expect(said('orders-dev-nightly')).toBe('entry:orders:invoke:orders-dev-nightly');
    expect(said('OrdersService.create()')).toBe('orders#src/orders.service.ts:OrdersService.create');
  });

  it('says a name the graph should hold and does not is dead, and nothing of a name that is not the graph’s', () => {
    expect(said('POST /cart')).toMatch(/^dead/);
    expect(said('OrdersService.cancelAll')).toBe('dead, near orders#src/orders.service.ts:OrdersService.create');
    expect(said('JSON.parse')).toBeUndefined();
    expect(said('npm install')).toBeUndefined();
    expect(said('orders')).toBeUndefined();
  });
});
