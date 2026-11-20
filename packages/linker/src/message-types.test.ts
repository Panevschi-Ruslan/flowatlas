import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
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
