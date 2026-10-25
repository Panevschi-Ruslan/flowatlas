import { CHANNEL_DECLARED_META, WHERE_DECLARED_META, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { keepWhereDeclared } from './declared-link.js';
import { edgeKey } from './order.js';

const channel = (name: string, declared: boolean): GraphNode => ({
  id: `channel:${name}`,
  type: 'channel',
  label: name,
  repo: 'shop',
  file: 'infra/main.tf',
  line: 1,
  meta: declared ? { [CHANNEL_DECLARED_META]: `declares ${name}` } : {},
});

const writer = (id: string): GraphNode => ({
  id,
  type: 'producer',
  label: `write ${id}`,
  repo: 'returns',
  file: 'src/a.ts',
  line: 3,
  meta: { [WHERE_DECLARED_META]: true },
});

const edge = (from: string, to: string, type: GraphEdge['type']): GraphEdge => ({ from, to, type, confidence: 'static' });

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]) => ({
  nodes: new Map(nodes.map((node) => [node.id, node])),
  edges: new Map(edges.map((each) => [edgeKey(each), each])),
});

const row = (symbol: string): Unresolved => ({ service: 'returns', file: 'src/a.ts', line: 3, reason: 'channel-dynamic', message: 'x', symbol });

describe('a write that is a publish only where its stream is declared (P51)', () => {
  it('keeps a write onto a declared stream, and drops one onto a table with none, with its rows and its channel', () => {
    const { nodes, edges } = graphOf(
      [
        channel('dynamodb/shop-orders', true),
        channel('dynamodb/shop-carts', false),
        writer('producer:orders'),
        writer('producer:carts'),
        { id: 'fn', type: 'function', label: 'handler', repo: 'returns' },
        { id: 'consumer:orders', type: 'consumer', label: 'mapping', repo: 'shop' },
      ],
      [
        edge('fn', 'producer:orders', 'calls'),
        edge('fn', 'producer:carts', 'calls'),
        edge('producer:orders', 'channel:dynamodb/shop-orders', 'emits'),
        edge('producer:carts', 'channel:dynamodb/shop-carts', 'emits'),
        edge('channel:dynamodb/shop-orders', 'consumer:orders', 'consumes'),
      ],
    );
    const rows = [row('producer:carts'), row('producer:orders')];
    expect(keepWhereDeclared(nodes, edges, [rows])).toEqual([]);
    expect([...nodes.keys()].sort()).toEqual(['channel:dynamodb/shop-orders', 'consumer:orders', 'fn', 'producer:orders']);
    expect([...edges.keys()].sort()).toEqual([
      'channel:dynamodb/shop-orders consumes consumer:orders',
      'fn calls producer:orders',
      'producer:orders emits channel:dynamodb/shop-orders',
    ]);
    expect(rows.map((each) => each.symbol)).toEqual(['producer:orders']);
  });

  it('says, at info, that a declared stream something reads has no writer', () => {
    const { nodes, edges } = graphOf(
      [channel('kinesis/shop-clicks', true), channel('dynamodb/shop-quiet', true), { id: 'consumer:clicks', type: 'consumer', label: 'mapping', repo: 'shop' }],
      [edge('channel:kinesis/shop-clicks', 'consumer:clicks', 'consumes')],
    );
    expect(keepWhereDeclared(nodes, edges, []).map((found) => [found.reason, found.level, found.symbol])).toEqual([
      ['stream-no-writer', 'info', 'channel:kinesis/shop-clicks'],
    ]);
  });
});
