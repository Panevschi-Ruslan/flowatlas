import { nameWrittenOf, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { joinMessageTypes } from './message-types.js';
import { edgeKey } from './order.js';
import type { TypeNameSources } from './type-names.js';

/**
 * Where each type's name is written (P404), and what it settles of "nothing
 * selects it": a type whose name is written only where it is sent is chosen
 * by no code past a consumer that takes every type; a place it is written
 * and no choice was read, or a test that may take it, stays open, named.
 */
const CHANNEL = 'channel:shelf_events';

const node = (id: string, over: Partial<GraphNode>): GraphNode => ({ id, type: 'method', label: id, repo: 'api', ...over });
const edge = (from: string, to: string, type: GraphEdge['type']): GraphEdge => ({ from, to, type, confidence: 'static' });

const graph = () => {
  const nodes: GraphNode[] = [
    node(CHANNEL, { type: 'channel', label: 'shelf_events', meta: { channelKind: 'channel' } }),
    node('producer:api#src/books.ts:4:5', { type: 'producer', file: 'src/books.ts', line: 4, meta: { messageTypes: ['BOOK_ADDED'], discriminator: 'type' } }),
    node('producer:api#src/books.ts:8:5', { type: 'producer', file: 'src/books.ts', line: 8, meta: { messageTypes: ['BOOK_LENT'], discriminator: 'type' } }),
    node('worker#src/shelf.ts:Shelf.dispatch', { repo: 'worker', label: 'Shelf.dispatch', file: 'src/shelf.ts', line: 3 }),
    node('consumer:worker#src/shelf.ts:Shelf.dispatch', {
      type: 'consumer',
      repo: 'worker',
      label: 'Shelf.dispatch',
      file: 'src/shelf.ts',
      line: 3,
      meta: { discriminator: 'type', selects: [{ type: 'BOOK_ADDED', consumer: 'consumer:worker#src/shelf.ts:Shelf.dispatch', via: 'switch', line: 4 }] },
    }),
    node('worker#src/relay.ts:Relay.forward', { repo: 'worker', label: 'Relay.forward', file: 'src/relay.ts', line: 2 }),
    node('consumer:worker#src/relay.ts:Relay.forward', { type: 'consumer', repo: 'worker', label: 'Relay.forward', file: 'src/relay.ts', line: 2 }),
  ];
  const edges: GraphEdge[] = [
    edge('producer:api#src/books.ts:4:5', CHANNEL, 'emits'),
    edge('producer:api#src/books.ts:8:5', CHANNEL, 'emits'),
    edge(CHANNEL, 'consumer:worker#src/shelf.ts:Shelf.dispatch', 'consumes'),
    edge('consumer:worker#src/shelf.ts:Shelf.dispatch', 'worker#src/shelf.ts:Shelf.dispatch', 'handles'),
    edge(CHANNEL, 'consumer:worker#src/relay.ts:Relay.forward', 'consumes'),
    edge('consumer:worker#src/relay.ts:Relay.forward', 'worker#src/relay.ts:Relay.forward', 'handles'),
  ];
  return { nodes: new Map(nodes.map((each) => [each.id, each])), edges: new Map(edges.map((each) => [edgeKey(each), each])) };
};

const BOOKS = [
  "export enum BookEvent { Added = 'BOOK_ADDED', Lent = 'BOOK_LENT' }",
  'export class Books {',
  '  add(id: string): void {',
  "    this.bus.publish('shelf_events', { type: BookEvent.Added, id });",
  '  }',
  '',
  '  lend(id: string): void {',
  "    this.bus.publish('shelf_events', { type: BookEvent.Lent, id });",
  '  }',
  '}',
].join('\n');

const SHELF = ['export class Shelf {', '  dispatch(evt: { type: string }): void {', '    switch (evt.type) {', "      case 'BOOK_ADDED':", '        break;', '    }', '  }', '}'].join('\n');

const sources = (worker: Record<string, string> | undefined): TypeNameSources => ({
  services: [
    { service: 'api', files: ['src/books.ts'], read: (file) => (file === 'src/books.ts' ? BOOKS : undefined) },
    ...(worker === undefined ? [] : [{ service: 'worker', files: Object.keys(worker), read: (file: string) => worker[file] }]),
  ],
});

const lentOf = (worker: Record<string, string> | undefined) => {
  const { nodes, edges } = graph();
  const rows = joinMessageTypes(nodes, edges, sources(worker));
  return { written: nameWrittenOf(nodes.get(`${CHANNEL}#BOOK_LENT`)), row: rows.find((each) => each.reason === 'message-type-unselected') };
};

describe('where a type name is written', () => {
  it('settles a type whose name is written only where it is sent, through the enum member it is sent by', () => {
    const { written, row } = lentOf({ 'src/shelf.ts': SHELF, 'src/relay.ts': 'export class Relay { forward(evt: unknown): void { this.out.push(evt); } }' });
    expect(written).toMatchObject({ sent: [{ service: 'api', loc: 'src/books.ts:8' }], sentCount: 1, onlyAtSends: true, defined: 1, open: [], openCount: 0 });
    expect(row?.meta?.['sureness']).toBe('sure');
    expect(row?.message).toBe(
      'no code compares BOOK_LENT: its name is written only where it is sent, at src/books.ts:8 in api; 1 consumer chooses other types; 1 consumer takes every type and hands it on, and no code past it compares the name',
    );
  });

  it('keeps open a place the name is written that no choice was read at, and a test that may take it', () => {
    const { written, row } = lentOf({
      'src/shelf.ts': SHELF,
      'src/relay.ts': "export class Relay { forward(evt: { type: string }): void { if (evt.type === 'BOOK_LENT') this.out.push(evt); if (evt.type.startsWith('BOOK_')) this.n += 1; } }",
    });
    expect(written?.open.map((place) => [place.loc, place.why])).toEqual([
      ['src/relay.ts:1', 'BOOK_LENT is written here; the graph read no choice of it'],
      ['src/relay.ts:1', 'a prefix test that may take BOOK_LENT'],
    ]);
    expect(row?.meta?.['sureness']).toBe('unsure');
    expect(row?.message).toContain('2 places may still choose it');
  });

  it('does not count a choice the graph read, and names a service whose code was not read', () => {
    const { nodes, edges } = graph();
    joinMessageTypes(nodes, edges, sources({ 'src/shelf.ts': SHELF, 'src/relay.ts': '' }));
    expect(nameWrittenOf(nodes.get(`${CHANNEL}#BOOK_ADDED`))?.open).toEqual([]);
    expect(lentOf(undefined).written?.unread).toEqual(['worker']);
    expect(lentOf(undefined).row?.meta?.['sureness']).toBe('unsure');
  });

  it('counts a whole use of the enum defining it as a place it may be chosen', () => {
    const { written } = lentOf({ 'src/shelf.ts': SHELF, 'src/relay.ts': "import { BookEvent } from './books';\nexport const KEPT = new Set(Object.values(BookEvent));" });
    expect(written?.open.map((place) => place.why)).toEqual(['uses the whole of BookEvent, which defines BOOK_LENT']);
  });
});
