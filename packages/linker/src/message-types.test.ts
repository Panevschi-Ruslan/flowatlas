import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { subscribingCode, unreachedHandler } from './analysis/message-types.js';
import { joinMessageTypes, unselectedTypesOf } from './message-types.js';
import { edgeKey } from './order.js';

/**
 * Types of message drawn once the project is joined (P358): a publish of a
 * type `emits` onto the type's node, a handler selecting it `consumes` from
 * it, and a type published where consumers choose by type, chosen by none,
 * is a finding saying how sure it is.
 */
const CHANNEL = 'channel:shelf:*:events';

const node = (id: string, over: Partial<GraphNode>): GraphNode => ({ id, type: 'method', label: id, repo: 'api', ...over });
const edge = (from: string, to: string, type: GraphEdge['type'], over: Partial<GraphEdge> = {}): GraphEdge => ({ from, to, type, confidence: 'static', ...over });

const build = (options: { generic?: boolean; unbuilt?: boolean } = {}) => {
  const nodes: GraphNode[] = [
    node(CHANNEL, { type: 'channel', label: 'shelf:*:events', meta: { channelKind: 'channel' } }),
    node('producer:api#a.ts:1:1', { type: 'producer', file: 'a.ts', line: 1, meta: { messageTypes: ['BOOK_ADDED'], discriminator: 'type' } }),
    node('producer:api#a.ts:2:1', { type: 'producer', file: 'a.ts', line: 2, meta: { messageTypes: ['BOOK_LENT'], discriminator: 'type' } }),
    node('producer:api#a.ts:3:1', { type: 'producer', file: 'a.ts', line: 3, meta: { messageTypeUnread: 'a union', discriminator: 'type' } }),
    node('worker#w.ts:Shelf', { type: 'provider', repo: 'worker', label: 'Shelf', meta: options.unbuilt === true ? {} : { module: 'AppModule' } }),
    node('worker#w.ts:AppModule', { type: 'module', repo: 'worker' }),
    node('worker#w.ts:Shelf.dispatch', { repo: 'worker', label: 'Shelf.dispatch' }),
    node('worker#w.ts:Shelf.onAdded', { repo: 'worker', label: 'Shelf.onAdded' }),
    node('consumer:worker#w.ts:Shelf.dispatch', {
      type: 'consumer',
      repo: 'worker',
      label: 'Shelf.dispatch',
      file: 'w.ts',
      line: 5,
      meta: { discriminator: 'type', selects: [{ type: 'BOOK_ADDED', consumer: 'consumer:worker#w.ts:Shelf.onAdded', via: 'switch', line: 7 }] },
    }),
    node('consumer:worker#w.ts:Shelf.onAdded', { type: 'consumer', repo: 'worker', label: 'Shelf.onAdded', meta: { selectedBy: 'consumer:worker#w.ts:Shelf.dispatch' } }),
    ...(options.generic === true
      ? [
          node('gateway#g.ts:Relay.forward', { repo: 'gateway', label: 'Relay.forward' }),
          node('consumer:gateway#g.ts:Relay.forward', { type: 'consumer', repo: 'gateway', label: 'Relay.forward' }),
        ]
      : []),
  ];
  const edges: GraphEdge[] = [
    edge('producer:api#a.ts:1:1', CHANNEL, 'emits', { params: ['type:api#BookAdded'] }),
    edge('producer:api#a.ts:2:1', CHANNEL, 'emits'),
    edge('producer:api#a.ts:3:1', CHANNEL, 'emits'),
    edge(CHANNEL, 'consumer:worker#w.ts:Shelf.dispatch', 'consumes'),
    edge('consumer:worker#w.ts:Shelf.dispatch', 'worker#w.ts:Shelf.dispatch', 'handles'),
    edge('consumer:worker#w.ts:Shelf.onAdded', 'worker#w.ts:Shelf.onAdded', 'handles'),
    ...(options.generic === true
      ? [edge(CHANNEL, 'consumer:gateway#g.ts:Relay.forward', 'consumes'), edge('consumer:gateway#g.ts:Relay.forward', 'gateway#g.ts:Relay.forward', 'handles')]
      : []),
  ];
  return {
    nodes: new Map(nodes.map((each) => [each.id, each])),
    edges: new Map(edges.map((each) => [edgeKey(each), each])),
  };
};

describe('types of message on a joined channel', () => {
  it('draws a node per type, the publish of it emitting there and the handler selecting it consuming from there', () => {
    const { nodes, edges } = build();
    joinMessageTypes(nodes, edges);
    const added = nodes.get(`${CHANNEL}#BOOK_ADDED`);
    expect(added).toMatchObject({ type: 'channel', kind: 'message_type', label: 'shelf:*:events#BOOK_ADDED', meta: { channel: CHANNEL, messageType: 'BOOK_ADDED' } });
    const all = [...edges.values()];
    expect(all).toContainEqual(expect.objectContaining({ from: 'producer:api#a.ts:1:1', to: `${CHANNEL}#BOOK_ADDED`, type: 'emits', params: ['type:api#BookAdded'] }));
    expect(all).toContainEqual(
      expect.objectContaining({ from: `${CHANNEL}#BOOK_ADDED`, to: 'consumer:worker#w.ts:Shelf.onAdded', type: 'consumes', meta: { selectedBy: 'consumer:worker#w.ts:Shelf.dispatch', via: 'switch' } }),
    );
    // A publish whose type was not read is on its channel and on no type.
    expect(all.filter((each) => each.from === 'producer:api#a.ts:3:1').map((each) => each.to)).toEqual([CHANNEL]);
  });

  it('finds a type published and selected by nothing, sure where every consumer chooses by type', () => {
    const { nodes, edges } = build();
    const rows = joinMessageTypes(nodes, edges);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'message-type-unselected', symbol: 'producer:api#a.ts:2:1', service: 'api', meta: { type: `${CHANNEL}#BOOK_LENT`, sureness: 'sure' } });
    expect(rows[0]!.message).toContain('no code that runs selects BOOK_LENT on shelf:*:events: 1 consumer chooses other types (Shelf.dispatch)');
    expect(unselectedTypesOf(rows)).toEqual([`${CHANNEL}#BOOK_LENT`]);
  });

  it('is unsure where a consumer passes every type on without choosing', () => {
    const { nodes, edges } = build({ generic: true });
    const [row] = joinMessageTypes(nodes, edges);
    expect(row?.meta).toMatchObject({ sureness: 'unsure' });
    expect(row?.message).toContain('Relay.forward passes every type on without choosing');
  });

  it('counts a selection in a class nothing builds as no selection, and says why', () => {
    const { nodes, edges } = build({ unbuilt: true });
    const rows = joinMessageTypes(nodes, edges);
    const added = rows.find((row) => row.meta?.['type'] === `${CHANNEL}#BOOK_ADDED`);
    expect(added?.message).toContain('only Shelf.onAdded selects it, and nothing builds Shelf: no module registers it and nothing injects it');
  });

  it('says nothing about types where no consumer of the channel chooses by type', () => {
    const { nodes, edges } = build({ generic: true });
    nodes.delete('consumer:worker#w.ts:Shelf.dispatch');
    edges.delete(edgeKey(edge(CHANNEL, 'consumer:worker#w.ts:Shelf.dispatch', 'consumes')));
    expect(joinMessageTypes(nodes, edges)).toEqual([]);
  });
});

describe('types of message reaching screens through a stream (P362)', () => {
  const ROUTE = 'entry:api:http:GET:/shelves/:param/events';
  /** The channel relayed by a route onto a stream, a screen service pushing it into a subject, and a screen subscribed. */
  const streamed = (options: { screenless?: boolean; unreached?: boolean } = {}) => {
    const { nodes, edges } = build();
    const add = (each: GraphNode) => nodes.set(each.id, each);
    const join = (each: GraphEdge) => edges.set(edgeKey(each), each);
    add(node('api#s.ts:events', { type: 'function', label: 'events' }));
    add(node('consumer:api#s.ts:events', { type: 'consumer', label: 'events', kind: 'sse', meta: { relay: ROUTE } }));
    join(edge(CHANNEL, 'consumer:api#s.ts:events', 'consumes'));
    join(edge('consumer:api#s.ts:events', 'api#s.ts:events', 'handles'));
    if (options.screenless === true) return { nodes, edges };
    add(node('web#f.ts:Feed.open', { repo: 'web', label: 'Feed.open' }));
    add(node('web#p.ts:Page.init', { repo: 'web', label: 'Page.init' }));
    add(node('consumer:web#f.ts:Feed.open', { type: 'consumer', repo: 'web', label: 'Feed.open', meta: { handsOnTo: ['consumer:web#p.ts:Page.init'] } }));
    add(
      node('consumer:web#p.ts:Page.init', {
        type: 'consumer',
        repo: 'web',
        label: 'Page.init',
        meta: {
          discriminator: 'type',
          selects: [{ type: 'BOOK_LENT', consumer: 'consumer:web#p.ts:Page.init', via: 'filter', line: 4 }],
          ...(options.unreached === true ? { unreached: 'nothing injects or makes Feed' } : {}),
        },
      }),
    );
    for (const screen of ['consumer:web#f.ts:Feed.open', 'consumer:web#p.ts:Page.init']) {
      join(edge(CHANNEL, screen, 'consumes', { meta: { via: 'sse', route: ROUTE } }));
    }
    join(edge('consumer:web#f.ts:Feed.open', 'web#f.ts:Feed.open', 'handles'));
    join(edge('consumer:web#p.ts:Page.init', 'web#p.ts:Page.init', 'handles'));
    return { nodes, edges };
  };

  it('selects a type at the screen, the route and the service in front of it passing it on to what was read', () => {
    const { nodes, edges } = streamed();
    const rows = joinMessageTypes(nodes, edges);
    expect(rows.map((row) => row.meta?.['type'])).toEqual([]);
    expect([...edges.values()]).toContainEqual(expect.objectContaining({ from: `${CHANNEL}#BOOK_LENT`, to: 'consumer:web#p.ts:Page.init', type: 'consumes' }));
  });

  it('is unsure of a type where the route relays it to no screen read', () => {
    const { nodes, edges } = streamed({ screenless: true });
    const lent = joinMessageTypes(nodes, edges).find((row) => row.meta?.['type'] === `${CHANNEL}#BOOK_LENT`);
    expect(lent?.meta).toMatchObject({ sureness: 'unsure' });
    expect(lent?.message).toContain('events passes every type on without choosing');
  });

  it('counts a screen subscribed through a service nothing makes as no selection, sure where everything else was read', () => {
    const { nodes, edges } = streamed({ unreached: true });
    const lent = joinMessageTypes(nodes, edges).find((row) => row.meta?.['type'] === `${CHANNEL}#BOOK_LENT`);
    expect(lent?.message).toContain('only Page.init selects it, and nothing injects or makes Feed');
    expect(lent?.meta).toMatchObject({ sureness: 'sure' });
  });
});

describe('a per-scope hub\'s own channel (P362)', () => {
  it('draws no type on the channel of a hub handed other channels, where nothing written to it says one', () => {
    const HUB = 'channel:durable-object:Hub';
    const nodes = new Map<string, GraphNode>(
      [
        node(HUB, { type: 'channel', label: 'durable-object:Hub', meta: { channelKind: 'channel', heldBy: 'Hub', forwards: ['channel:shelf:*:events'] } }),
        node('producer:api#b.ts:1:1', { type: 'producer', file: 'b.ts', line: 1 }),
        node('web#p.ts:Page.init', { repo: 'web', label: 'Page.init' }),
        node('consumer:web#p.ts:Page.init', {
          type: 'consumer',
          repo: 'web',
          label: 'Page.init',
          meta: { discriminator: 'type', selects: [{ type: 'BOOK_LENT', consumer: 'consumer:web#p.ts:Page.init', via: 'if', line: 3 }] },
        }),
      ].map((each) => [each.id, each]),
    );
    const edges = new Map(
      [edge('producer:api#b.ts:1:1', HUB, 'emits'), edge(HUB, 'consumer:web#p.ts:Page.init', 'consumes'), edge('consumer:web#p.ts:Page.init', 'web#p.ts:Page.init', 'handles')].map((each) => [edgeKey(each), each]),
    );
    joinMessageTypes(nodes, edges);
    expect(nodes.has(`${HUB}#BOOK_LENT`)).toBe(false);
  });
});

describe('a type selected on a channel that never carries it (P362)', () => {
  const OTHER = 'channel:desk:*:calls';
  const joined = (unread: boolean) => {
    const { nodes, edges } = build();
    const add = (each: GraphNode) => nodes.set(each.id, each);
    const join = (each: GraphEdge) => edges.set(edgeKey(each), each);
    add(node(OTHER, { type: 'channel', label: 'desk:*:calls', meta: { channelKind: 'channel' } }));
    add(node('producer:api#d.ts:1:1', { type: 'producer', file: 'd.ts', line: 1, meta: { messageTypes: ['DESK_CALLED'], discriminator: 'type' } }));
    if (unread) add(node('producer:api#d.ts:2:1', { type: 'producer', file: 'd.ts', line: 2, meta: { messageTypeUnread: 'a union', discriminator: 'type' } }));
    add(node('web#s.ts:Screen.init', { repo: 'web', label: 'Screen.init' }));
    add(
      node('consumer:web#s.ts:Screen.init', {
        type: 'consumer',
        repo: 'web',
        label: 'Screen.init',
        meta: { discriminator: 'type', selects: [{ type: 'DESK_CALLED', consumer: 'consumer:web#s.ts:Screen.init', via: 'if', line: 2 }] },
      }),
    );
    // One stream joins the screen to both channels.
    join(edge('producer:api#d.ts:1:1', OTHER, 'emits'));
    if (unread) join(edge('producer:api#d.ts:2:1', CHANNEL, 'emits'));
    // The shelf channel's own publish whose type was not read is left out unless asked for.
    else edges.delete(edgeKey(edge('producer:api#a.ts:3:1', CHANNEL, 'emits')));
    join(edge(OTHER, 'consumer:web#s.ts:Screen.init', 'consumes', { meta: { via: 'sse' } }));
    join(edge(CHANNEL, 'consumer:web#s.ts:Screen.init', 'consumes', { meta: { via: 'sse' } }));
    join(edge('consumer:web#s.ts:Screen.init', 'web#s.ts:Screen.init', 'handles'));
    joinMessageTypes(nodes, edges);
    return { nodes, edges };
  };

  it('draws the selection only on the channel whose publishes carry the type', () => {
    const { nodes } = joined(false);
    expect(nodes.has(`${OTHER}#DESK_CALLED`)).toBe(true);
    // Every publish on the shelf channel was read, and none is DESK_CALLED.
    expect(nodes.has(`${CHANNEL}#DESK_CALLED`)).toBe(false);
  });

  it('draws it as a guess on a channel with a publish whose type was not read', () => {
    const { nodes, edges } = joined(true);
    expect(nodes.has(`${CHANNEL}#DESK_CALLED`)).toBe(true);
    const drawn = [...edges.values()].find((each) => each.from === `${CHANNEL}#DESK_CALLED`);
    expect(drawn?.confidence).toBe('heuristic');
  });
});

describe('a subscriber to every channel of a bus (P374)', () => {
  const DESKS = 'channel:desks';
  const CARTS = 'channel:carts';
  const RELAY = 'consumer:api#r.ts:Relay.start';
  const joined = (cartsUnread: boolean) => {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const add = (each: GraphNode) => nodes.set(each.id, each);
    const join = (each: GraphEdge) => edges.set(edgeKey(each), each);
    add(node(DESKS, { type: 'channel', label: 'desks', meta: { channelKind: 'channel' } }));
    add(node(CARTS, { type: 'channel', label: 'carts', meta: { channelKind: 'channel' } }));
    add(node('producer:api#d.ts:1:1', { type: 'producer', file: 'd.ts', line: 1, meta: { messageTypes: ['HELP'], discriminator: 'type' } }));
    // A cart's frame carries no type at all, or (asked) one not read.
    add(node('producer:api#c.ts:1:1', { type: 'producer', file: 'c.ts', line: 1, meta: cartsUnread ? { messageTypeUnread: 'a string', discriminator: 'type' } : {} }));
    add(node('api#r.ts:Relay.page', { label: 'Relay.page' }));
    add(
      node(RELAY, {
        type: 'consumer',
        label: 'Relay.start',
        meta: { discriminator: 'type', selects: [{ type: 'HELP', consumer: 'consumer:api#r.ts:Relay.page', via: 'if', line: 3 }] },
      }),
    );
    add(node('consumer:api#r.ts:Relay.page', { type: 'consumer', label: 'Relay.page', meta: { selectedBy: RELAY } }));
    join(edge('producer:api#d.ts:1:1', DESKS, 'emits'));
    join(edge('producer:api#c.ts:1:1', CARTS, 'emits'));
    join(edge(DESKS, RELAY, 'consumes', { meta: { via: 'every-channel' } }));
    join(edge(CARTS, RELAY, 'consumes', { meta: { via: 'every-channel' } }));
    join(edge('consumer:api#r.ts:Relay.page', 'api#r.ts:Relay.page', 'handles'));
    joinMessageTypes(nodes, edges);
    return { nodes, edges };
  };

  it('draws a type it selects only on the channels whose publishes send it, not on one whose publishes send no type', () => {
    const { nodes } = joined(false);
    expect(nodes.has(`${DESKS}#HELP`)).toBe(true);
    expect(nodes.has(`${CARTS}#HELP`)).toBe(false);
  });

  it('draws it as a guess on a channel with a publish whose type was not read', () => {
    const { nodes, edges } = joined(true);
    expect(nodes.has(`${CARTS}#HELP`)).toBe(true);
    expect([...edges.values()].find((each) => each.from === `${CARTS}#HELP`)?.confidence).toBe('heuristic');
  });
});

describe('a consumer whose subscription is made in code nothing runs (P374)', () => {
  const lookupOf = (nodes: GraphNode[], edges: GraphEdge[]) => ({
    node: (id: string) => nodes.find((each) => each.id === id),
    edgesTo: (id: string, types?: readonly string[]) => edges.filter((each) => each.to === id && (types === undefined || types.includes(each.type))),
    edgesFrom: (id: string, types?: readonly string[]) => edges.filter((each) => each.from === id && (types === undefined || types.includes(each.type))),
    nodesByType: (type: string) => nodes.filter((each) => each.type === type),
  });
  const SUBSCRIBER = 'consumer:web#n.ts:Notices.start';
  const CHOSEN = 'consumer:web#n.ts:Notices.handle';
  const graph = (over: { injected?: boolean; calledFromOutside?: boolean } = {}) => {
    const nodes: GraphNode[] = [
      node('web#n.ts:Notices', { type: 'provider', repo: 'web', label: 'Notices', meta: { providedIn: 'root' } }),
      node('web#n.ts:Notices.start', { repo: 'web', label: 'Notices.start' }),
      node('web#n.ts:Notices.handle', { repo: 'web', label: 'Notices.handle' }),
      node('web#t.ts:Toast.show', { repo: 'web', label: 'Toast.show' }),
      node('web#s.ts:Screen.init', { repo: 'web', label: 'Screen.init' }),
      node(SUBSCRIBER, { type: 'consumer', repo: 'web', label: 'Notices.start', meta: { subscriptions: [{ line: 3, column: 5, through: 'Live.stream$' }] } }),
      node(CHOSEN, { type: 'consumer', repo: 'web', label: 'Notices.handle', meta: { selectedBy: SUBSCRIBER } }),
    ];
    const edges: GraphEdge[] = [
      edge(SUBSCRIBER, 'web#n.ts:Notices.start', 'handles'),
      edge(CHOSEN, 'web#n.ts:Notices.handle', 'handles'),
      edge('web#n.ts:Notices.start', 'web#n.ts:Notices.handle', 'calls'),
      edge('web#n.ts:Notices.handle', 'web#t.ts:Toast.show', 'calls'),
      ...(over.injected === true ? [edge('web#s.ts:Screen', 'web#n.ts:Notices', 'injects')] : []),
      ...(over.calledFromOutside === true ? [edge('web#s.ts:Screen.init', 'web#n.ts:Notices.start', 'calls')] : []),
    ];
    return lookupOf(nodes, edges);
  };

  it('never runs, nor does the handler its dispatch chose, where nothing builds the class and nothing outside it calls it', () => {
    const lookup = graph();
    expect(subscribingCode(lookup, lookup.node(CHOSEN)!)?.id).toBe('web#n.ts:Notices.start');
    expect(unreachedHandler(lookup, lookup.node(SUBSCRIBER)!)).toContain('nothing builds Notices');
    expect(unreachedHandler(lookup, lookup.node(CHOSEN)!)).toContain('Notices.start, where the subscription is made');
  });

  it('may run where something injects the class or calls its methods from outside it', () => {
    for (const lookup of [graph({ injected: true }), graph({ calledFromOutside: true })]) {
      expect(unreachedHandler(lookup, lookup.node(CHOSEN)!)).toBeUndefined();
    }
  });
});
