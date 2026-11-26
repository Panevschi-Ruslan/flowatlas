import { selectionsOf, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinMessageTypes, UNSELECTED_HELD_META } from './message-types.js';
import { edgeKey } from './order.js';

/**
 * Types of message that agree with each other (P400): "nothing selects this
 * type" held back where a consumer choosing it receives channels not all
 * read, the mirror of P395's hold on `type-never-published`; and the handler
 * of an `else` taking the remaining types the channel carries, where those
 * are known whole.
 */
const EVENTS = 'channel:shop:*:events';
const ORDERS = 'channel:shop:*:orders';
const STREAM = 'entry:api:http:GET:/shops/:param/feed';

const node = (id: string, over: Partial<GraphNode>): GraphNode => ({ id, type: 'method', label: id, repo: 'api', ...over });
const edge = (from: string, to: string, type: GraphEdge['type'], over: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, type, confidence: 'static', ...over });

const maps = (nodes: GraphNode[], edges: GraphEdge[]) => ({
  nodes: new Map(nodes.map((each) => [each.id, each])),
  edges: new Map(edges.map((each) => [edgeKey(each), each])),
});

/** A screen choosing ALERT_RAISED through a feed that relays the orders channel and one not read; ALERT_RAISED is published on the events channel. */
const relayed = (relaysUnread: boolean) =>
  maps(
    [
      node(EVENTS, { type: 'channel', label: 'shop:*:events' }),
      node(ORDERS, { type: 'channel', label: 'shop:*:orders' }),
      node(STREAM, { type: 'entry', kind: 'http', label: 'GET /shops/:param/feed', meta: relaysUnread ? { relaysUnread: '1 subscription(s) behind GET /shops/:param/feed name a channel not read' } : {} }),
      node('producer:api#e.ts:1:1', { type: 'producer', file: 'e.ts', line: 1, meta: { messageTypes: ['ALERT_RAISED'], discriminator: 'type' } }),
      node('producer:api#e.ts:2:1', { type: 'producer', file: 'e.ts', line: 2, meta: { messageTypes: ['AUDIT_ENTRY_CREATED'], discriminator: 'type' } }),
      node('producer:api#o.ts:1:1', { type: 'producer', file: 'o.ts', line: 1, meta: { messageTypes: ['ORDER_PLACED'], discriminator: 'type' } }),
      node('web#live.ts:handleLive', { type: 'function', repo: 'web', label: 'handleLive' }),
      node('consumer:web#live.ts:handleLive', {
        type: 'consumer',
        repo: 'web',
        label: 'handleLive',
        meta: { discriminator: 'type', selects: [{ type: 'AUDIT_ENTRY_CREATED', consumer: 'consumer:web#live.ts:handleLive', via: 'if', line: 3 }] },
      }),
      node('web#feed.ts:handleFeed', { type: 'function', repo: 'web', label: 'handleFeed' }),
      node('consumer:web#feed.ts:handleFeed', {
        type: 'consumer',
        repo: 'web',
        label: 'handleFeed',
        meta: { discriminator: 'type', selects: [{ type: 'ALERT_RAISED', consumer: 'consumer:web#feed.ts:handleFeed', via: 'if', line: 4 }] },
      }),
    ],
    [
      edge('producer:api#e.ts:1:1', EVENTS, 'emits'),
      edge('producer:api#e.ts:2:1', EVENTS, 'emits'),
      edge('producer:api#o.ts:1:1', ORDERS, 'emits'),
      edge(EVENTS, 'consumer:web#live.ts:handleLive', 'consumes'),
      edge('consumer:web#live.ts:handleLive', 'web#live.ts:handleLive', 'handles'),
      edge(ORDERS, 'consumer:web#feed.ts:handleFeed', 'consumes', { meta: { via: 'sse', route: STREAM } }),
      edge('consumer:web#feed.ts:handleFeed', 'web#feed.ts:handleFeed', 'handles'),
    ],
  );

describe('nothing selects a type, while a consumer choosing it receives channels not all read (P400)', () => {
  it('is unsure and held back, naming the consumer and why its channels are not known whole', () => {
    const { nodes, edges } = relayed(true);
    const row = joinMessageTypes(nodes, edges).find((each) => each.meta?.['messageType'] === 'ALERT_RAISED');
    expect(row?.meta).toMatchObject({ sureness: 'unsure' });
    expect(row?.message).toContain('handleFeed chooses it and receives channels not all read (1 subscription(s) behind GET /shops/:param/feed name a channel not read)');
    expect(row?.meta?.[UNSELECTED_HELD_META]).toBe('handleFeed chooses ALERT_RAISED, and 1 subscription(s) behind GET /shops/:param/feed name a channel not read');
  });

  it('stands, sure, where every channel the chooser receives is read', () => {
    const { nodes, edges } = relayed(false);
    const row = joinMessageTypes(nodes, edges).find((each) => each.meta?.['messageType'] === 'ALERT_RAISED');
    expect(row?.meta).toMatchObject({ sureness: 'sure' });
    expect(row?.meta?.[UNSELECTED_HELD_META]).toBeUndefined();
  });

  it('is held back too where the chooser receives a hub written to with a channel not read', () => {
    const { nodes, edges } = relayed(false);
    const orders = nodes.get(ORDERS)!;
    orders.meta = { forwards: [EVENTS], forwardsUnread: 1 };
    const row = joinMessageTypes(nodes, edges).find((each) => each.meta?.['messageType'] === 'ALERT_RAISED');
    expect(row?.meta?.[UNSELECTED_HELD_META]).toBe('handleFeed chooses ALERT_RAISED, and 1 write(s) to shop:*:orders hand it a channel not read');
  });
});

const BUILDS = 'channel:catalog_events';

/** A relay choosing PRICE_CHANGED with an if and handing the rest to another handler in its else. */
const withElse = (options: { unreadPublish?: boolean; parameter?: string } = {}) =>
  maps(
    [
      node(BUILDS, { type: 'channel', label: 'catalog_events' }),
      node('producer:api#c.ts:1:1', { type: 'producer', file: 'c.ts', line: 1, meta: { messageTypes: ['PRICE_CHANGED'], discriminator: 'type' } }),
      node('producer:api#c.ts:2:1', { type: 'producer', file: 'c.ts', line: 2, meta: { messageTypes: ['STOCK_LOW'], discriminator: 'type' } }),
      node('producer:api#c.ts:3:1', {
        type: 'producer',
        file: 'c.ts',
        line: 3,
        meta: options.unreadPublish === true ? { messageTypeUnread: 'a union', discriminator: 'type' } : { messageTypes: ['PRODUCT_RETIRED'], discriminator: 'type' },
      }),
      node('office#h.ts:Handlers.onOther', { repo: 'office', label: 'Handlers.onOther', file: 'h.ts', line: 9 }),
      node('office#h.ts:Handlers.onPrice', { repo: 'office', label: 'Handlers.onPrice', file: 'h.ts', line: 4 }),
      node('consumer:office#r.ts:Relay.dispatch', {
        type: 'consumer',
        repo: 'office',
        label: 'Relay.dispatch',
        file: 'r.ts',
        meta: {
          discriminator: 'type',
          selects: [{ type: 'PRICE_CHANGED', consumer: 'consumer:office#h.ts:Handlers.onPrice', via: 'if', line: 5 }],
          selectsRest: [{ consumer: 'consumer:office#h.ts:Handlers.onOther', handler: 'office#h.ts:Handlers.onOther', excluding: ['PRICE_CHANGED'], line: 7 }],
          ...(options.parameter === undefined
            ? {}
            : {
                selects: [
                  { type: 'PRICE_CHANGED', consumer: 'consumer:office#h.ts:Handlers.onPrice', via: 'if', line: 5 },
                  { type: options.parameter, consumer: 'consumer:office#h.ts:Handlers.onOther', via: 'parameter', line: 9 },
                ],
              }),
        },
      }),
      node('consumer:office#h.ts:Handlers.onPrice', { type: 'consumer', repo: 'office', label: 'Handlers.onPrice', meta: { selectedBy: 'consumer:office#r.ts:Relay.dispatch' } }),
      ...(options.parameter === undefined
        ? []
        : [node('consumer:office#h.ts:Handlers.onOther', { type: 'consumer', repo: 'office', label: 'Handlers.onOther', meta: { selectedBy: 'consumer:office#r.ts:Relay.dispatch' } })]),
    ],
    [
      edge('producer:api#c.ts:1:1', BUILDS, 'emits'),
      edge('producer:api#c.ts:2:1', BUILDS, 'emits'),
      edge('producer:api#c.ts:3:1', BUILDS, 'emits'),
      edge(BUILDS, 'consumer:office#r.ts:Relay.dispatch', 'consumes'),
      edge('consumer:office#h.ts:Handlers.onPrice', 'office#h.ts:Handlers.onPrice', 'handles'),
    ],
  );

describe('the else that ends a choice on the type takes the remaining types (P400)', () => {
  it('draws the types the channel carries that the branches before it do not choose, the handler drawn as a consumer', () => {
    const { nodes, edges } = withElse();
    const rows = joinMessageTypes(nodes, edges);
    const relay = nodes.get('consumer:office#r.ts:Relay.dispatch');
    expect(selectionsOf(relay).filter((each) => each.via === 'else')).toEqual([
      { type: 'PRODUCT_RETIRED', consumer: 'consumer:office#h.ts:Handlers.onOther', via: 'else', line: 7 },
      { type: 'STOCK_LOW', consumer: 'consumer:office#h.ts:Handlers.onOther', via: 'else', line: 7 },
    ]);
    expect(nodes.get('consumer:office#h.ts:Handlers.onOther')).toMatchObject({ type: 'consumer', label: 'Handlers.onOther', meta: { selectedBy: 'consumer:office#r.ts:Relay.dispatch' } });
    const all = [...edges.values()];
    expect(all).toContainEqual(expect.objectContaining({ from: 'consumer:office#h.ts:Handlers.onOther', to: 'office#h.ts:Handlers.onOther', type: 'handles' }));
    expect(all).toContainEqual(expect.objectContaining({ from: `${BUILDS}#STOCK_LOW`, to: 'consumer:office#h.ts:Handlers.onOther', type: 'consumes', meta: { selectedBy: 'consumer:office#r.ts:Relay.dispatch', via: 'else' } }));
    // Every type is selected now: nothing to say.
    expect(rows.filter((row) => row.reason === 'message-type-unselected')).toEqual([]);
  });

  it('chooses none where a publish on the channel sends a type not read, as before', () => {
    const { nodes, edges } = withElse({ unreadPublish: true });
    joinMessageTypes(nodes, edges);
    expect(selectionsOf(nodes.get('consumer:office#r.ts:Relay.dispatch')).some((each) => each.via === 'else')).toBe(false);
    expect(nodes.has('consumer:office#h.ts:Handlers.onOther')).toBe(false);
  });

  it("keeps a parameter's type, and says so on the handler where the else's remaining types differ", () => {
    const differs = withElse({ parameter: 'PRODUCT_RETIRED' });
    joinMessageTypes(differs.nodes, differs.edges);
    expect(differs.nodes.get('consumer:office#h.ts:Handlers.onOther')?.meta?.['selectionDiffers']).toBe(
      "its parameter's type says PRODUCT_RETIRED; the else it is called in takes the remaining PRODUCT_RETIRED, STOCK_LOW",
    );
    expect(selectionsOf(differs.nodes.get('consumer:office#r.ts:Relay.dispatch')).some((each) => each.via === 'else')).toBe(false);
    const agrees = withElse({ parameter: 'PRODUCT_RETIRED', unreadPublish: false });
    agrees.edges.delete(edgeKey(edge('producer:api#c.ts:2:1', BUILDS, 'emits')));
    joinMessageTypes(agrees.nodes, agrees.edges);
    expect(agrees.nodes.get('consumer:office#h.ts:Handlers.onOther')?.meta?.['selectionDiffers']).toBeUndefined();
  });
});
