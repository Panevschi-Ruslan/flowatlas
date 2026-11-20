import { afterAll, describe, expect, it } from 'vitest';
import { buildTestDb, node, removeTestDbs } from '../test-graph.js';
import { resolveChannelRef, type ChannelRef } from './channel-ref.js';

afterAll(removeTestDbs);

const channel = (name: string) => node(`channel:${name}`, { type: 'channel', label: name, repo: '' });

const db = buildTestDb({
  nodes: [
    channel('tenant:*:events'),
    channel('tenant:*:audit'),
    channel('order.created'),
    channel('orders/*/shipped'),
    channel('shop:main:alerts'),
    channel('*'),
    node('orders#src/orders.service.ts:OrdersService.create'),
  ],
  edges: [],
});

const used = (ref: ChannelRef | undefined): string | undefined =>
  ref === undefined ? undefined : 'candidates' in ref ? `candidates: ${ref.candidates.map((found) => found.id).join(', ')}` : ref.node.id;

describe('a channel as code and docs write it (P360)', () => {
  it('answers an exact name as before, with or without its prefix, and says nothing more', () => {
    expect(resolveChannelRef(db, 'order.created')).toEqual({ node: expect.objectContaining({ id: 'channel:order.created' }) });
    expect(resolveChannelRef(db, ' channel:order.created ')).toEqual({ node: expect.objectContaining({ id: 'channel:order.created' }) });
    expect(resolveChannelRef(db, 'tenant:*:events')).toEqual({ node: expect.objectContaining({ id: 'channel:tenant:*:events' }) });
  });

  it('reads every placeholder as the part the graph writes as *', () => {
    for (const asked of [
      'tenant:<id>:events',
      'tenant:{tenantId}:events',
      'tenant:${tenantId}:events',
      'tenant:${ctx.tenant.id}:events',
      'channel:tenant:<id>:events',
      'channel:tenant:{id}:events',
    ]) {
      const found = resolveChannelRef(db, asked);
      expect(found, asked).toEqual({ node: expect.objectContaining({ id: 'channel:tenant:*:events' }), channelUsed: 'channel:tenant:*:events' });
    }
    expect(used(resolveChannelRef(db, 'orders/:orderId/shipped'))).toBe('channel:orders/*/shipped');
    expect(used(resolveChannelRef(db, 'orders/[orderId]/shipped'))).toBe('channel:orders/*/shipped');
  });

  it('reads a value as the channel the graph could not spell out', () => {
    expect(resolveChannelRef(db, 'tenant:42:events')).toEqual({
      node: expect.objectContaining({ id: 'channel:tenant:*:events' }),
      channelUsed: 'channel:tenant:*:events',
    });
    expect(used(resolveChannelRef(db, 'orders/9f2/shipped'))).toBe('channel:orders/*/shipped');
  });

  it('lets a placeholder stand for a value the graph wrote out', () => {
    expect(used(resolveChannelRef(db, 'shop:<store>:alerts'))).toBe('channel:shop:main:alerts');
  });

  it('lists every channel a name fits when it fits several', () => {
    expect(used(resolveChannelRef(db, 'tenant:<id>:<kind>'))).toBe('candidates: channel:tenant:*:audit, channel:tenant:*:events');
  });

  it('fits nothing to a name that spells another channel out, nor to a channel of nothing but a *', () => {
    expect(resolveChannelRef(db, 'order.updated')).toBeUndefined();
    expect(resolveChannelRef(db, 'payments:42:events')).toBeUndefined();
    expect(resolveChannelRef(db, '<anything>')).toBeUndefined();
  });

  it('reads a plain word as a channel only with its prefix or a placeholder, for a tool that takes any node', () => {
    expect(resolveChannelRef(db, 'order.created', { anyName: true })).toBeUndefined();
    expect(resolveChannelRef(db, 'tenant:42:events', { anyName: true })).toBeUndefined();
    expect(used(resolveChannelRef(db, 'channel:tenant:42:events', { anyName: true }))).toBe('channel:tenant:*:events');
    expect(used(resolveChannelRef(db, 'tenant:<id>:events', { anyName: true }))).toBe('channel:tenant:*:events');
    expect(resolveChannelRef(db, 'OrdersService.create', { anyName: true })).toBeUndefined();
  });
});
