import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { DanglingEdgeError, DuplicateTypeError } from './errors.js';
import type { GraphEdge } from './model/edges.js';
import type { GraphNode } from './model/nodes.js';
import type { TypeEntry } from './model/types.js';
import { SCHEMA_VERSION } from './schema/version.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const builder = (): GraphBuilder => new GraphBuilder({ repo: 'orders', generatedAt: FIXED });

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo: 'orders',
  ...over,
});

const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'calls',
  confidence: 'static',
  ...over,
});

const type = (over: Partial<TypeEntry> = {}): TypeEntry => ({
  name: 'Order',
  kind: 'object',
  declaredIn: 'orders#src/order.ts',
  structuralHash: 'hash-1',
  ...over,
});

describe('GraphBuilder', () => {
  it('builds an empty graph at the current schema version', () => {
    const graph = builder().build();
    expect(graph).toEqual({
      schemaVersion: SCHEMA_VERSION,
      repo: 'orders',
      generatedAt: FIXED,
      nodes: [],
      edges: [],
      types: {},
      unresolved: [],
    });
  });

  it('keeps one node per id and merges meta with the existing keys winning', () => {
    const b = builder();
    b.addNode(node('a', { meta: { first: 1, shared: 'kept' } }));
    b.addNode(node('a', { label: 'ignored', meta: { second: 2, shared: 'discarded' } }));
    const graph = b.build();
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.label).toBe('a');
    expect(graph.nodes[0]?.meta).toEqual({ first: 1, second: 2, shared: 'kept' });
  });

  it('keeps one edge per from/type/to', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b'));
    b.addEdge(edge('a', 'b'));
    expect(b.build().edges).toHaveLength(1);
  });

  it('distinguishes edges that differ only by type', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b', { type: 'calls' }));
    b.addEdge(edge('a', 'b', { type: 'injects' }));
    expect(b.build().edges).toHaveLength(2);
  });

  it('upgrades to the stronger confidence when the same edge arrives twice', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b', { confidence: 'heuristic' }));
    b.addEdge(edge('a', 'b', { confidence: 'static' }));
    expect(b.build().edges[0]?.confidence).toBe('static');
  });

  it('does not downgrade an edge that already has stronger confidence', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b', { confidence: 'marker' }));
    b.addEdge(edge('a', 'b', { confidence: 'runtime' }));
    expect(b.build().edges[0]?.confidence).toBe('marker');
  });

  it('fills fields the first contribution left empty', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b', { confidence: 'heuristic' }));
    b.addEdge(
      edge('a', 'b', {
        confidence: 'static',
        params: ['type:orders#Dto'],
        returns: 'type:orders#Order',
        file: 'src/a.ts',
        line: 12,
      }),
    );
    expect(b.build().edges[0]).toMatchObject({
      confidence: 'static',
      params: ['type:orders#Dto'],
      returns: 'type:orders#Order',
      file: 'src/a.ts',
      line: 12,
    });
  });

  it('never overwrites a field the first contribution set', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b', { returns: 'type:orders#First' }));
    b.addEdge(edge('a', 'b', { returns: 'type:orders#Second' }));
    expect(b.build().edges[0]?.returns).toBe('type:orders#First');
  });

  it('does not alias the params array it was given', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    const params = ['type:orders#Dto'];
    b.addEdge(edge('a', 'b', { params }));
    params.push('type:orders#Leaked');
    expect(b.build().edges[0]?.params).toEqual(['type:orders#Dto']);
  });

  it('keeps one type per id', () => {
    const b = builder();
    b.addType('type:orders#Order', type());
    b.addType('type:orders#Order', type({ meta: { seen: 2 } }));
    const graph = b.build();
    expect(Object.keys(graph.types)).toEqual(['type:orders#Order']);
    expect(graph.types['type:orders#Order']?.meta).toEqual({ seen: 2 });
  });

  it('refuses the same type id with a different structure', () => {
    const b = builder();
    b.addType('type:orders#Order', type({ structuralHash: 'hash-1' }));
    expect(() => b.addType('type:orders#Order', type({ structuralHash: 'hash-2' }))).toThrow(
      DuplicateTypeError,
    );
  });

  it('deduplicates unresolved rows per site and exposes the count', () => {
    const b = builder();
    b.addUnresolved({ file: 'src/a.ts', line: 3, reason: 'dynamic-channel-name' });
    b.addUnresolved({ file: 'src/a.ts', line: 3, reason: 'dynamic-channel-name' });
    b.addUnresolved({ file: 'src/a.ts', line: 4, reason: 'dynamic-channel-name' });
    expect(b.unresolved).toHaveLength(2);
    expect(b.counts.unresolved).toBe(2);
    expect(b.build().unresolved).toHaveLength(2);
  });

  it('folds rows below action by reason and by level, never across the two', () => {
    // One reason raising both levels is not a case any pass makes today, and a
    // fold keyed on the reason alone would answer it by inventing a number:
    // one row, one level, and the count of both.
    const b = builder();
    b.addUnresolved({ file: 'src/a.ts', line: 1, reason: 'mixed', level: 'info' });
    b.addUnresolved({ file: 'src/b.ts', line: 2, reason: 'mixed', level: 'info' });
    b.addUnresolved({ file: 'src/c.ts', line: 3, reason: 'mixed', level: 'nothing' });
    const rows = b.build().unresolved;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.level, row.sites ?? 1])).toEqual(
      expect.arrayContaining([
        ['info', 2],
        ['nothing', 1],
      ]),
    );
  });

  it('throws when an edge points at a node that was never added', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addEdge(edge('a', 'missing'));
    expect(() => b.build()).toThrow(DanglingEdgeError);
  });

  it('names the offending edges in the dangling error', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addEdge(edge('a', 'missing'));
    try {
      b.build();
      expect.unreachable('build should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DanglingEdgeError);
      expect((error as DanglingEdgeError).edges).toHaveLength(1);
      expect((error as DanglingEdgeError).message).toContain('missing');
    }
  });

  it('produces the same bytes regardless of insertion order', () => {
    const fill = (order: readonly string[]): string => {
      const b = builder();
      for (const id of order) b.addNode(node(id));
      b.addEdge(edge('c', 'a'));
      b.addEdge(edge('a', 'b'));
      b.addEdge(edge('a', 'b', { type: 'injects' }));
      b.addType('type:orders#B', type({ name: 'B', structuralHash: 'b' }));
      b.addType('type:orders#A', type({ name: 'A', structuralHash: 'a' }));
      b.addUnresolved({ file: 'src/z.ts', line: 1, reason: 'r' });
      b.addUnresolved({ file: 'src/a.ts', line: 9, reason: 'r' });
      b.addUnresolved({ file: 'src/a.ts', line: 2, reason: 'r' });
      return JSON.stringify(b.build());
    };
    expect(fill(['a', 'b', 'c'])).toBe(fill(['c', 'b', 'a']));
  });

  it('sorts nodes, edges, types and unresolved rows', () => {
    const b = builder();
    for (const id of ['c', 'a', 'b']) b.addNode(node(id));
    b.addEdge(edge('b', 'a'));
    b.addEdge(edge('a', 'c'));
    b.addEdge(edge('a', 'b'));
    b.addType('type:orders#B', type({ structuralHash: 'b' }));
    b.addType('type:orders#A', type({ structuralHash: 'a' }));
    b.addUnresolved({ file: 'src/b.ts', line: 1, reason: 'r' });
    b.addUnresolved({ file: 'src/a.ts', line: 5, reason: 'z' });
    b.addUnresolved({ file: 'src/a.ts', line: 5, reason: 'a' });
    const graph = b.build();
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>b', 'a>c', 'b>a']);
    expect(Object.keys(graph.types)).toEqual(['type:orders#A', 'type:orders#B']);
    expect(graph.unresolved.map((u) => `${u.file}:${u.line}:${u.reason}`)).toEqual([
      'src/a.ts:5:a',
      'src/a.ts:5:z',
      'src/b.ts:1:r',
    ]);
  });

  it('answers has and getNode for the stored nodes', () => {
    const b = builder();
    b.addNode(node('a'));
    expect(b.has('a')).toBe(true);
    expect(b.has('b')).toBe(false);
    expect(b.getNode('a')?.id).toBe('a');
    expect(b.getNode('b')).toBeUndefined();
  });

  it('reports counts of everything collected', () => {
    const b = builder();
    b.addNode(node('a'));
    b.addNode(node('b'));
    b.addEdge(edge('a', 'b'));
    b.addType('type:orders#A', type());
    b.addUnresolved({ file: 'src/a.ts', line: 1, reason: 'r' });
    expect(b.counts).toEqual({ nodes: 2, edges: 1, types: 1, unresolved: 1 });
  });

  it('stamps a timestamp when none was fixed', () => {
    const graph = new GraphBuilder({ repo: 'orders' }).build();
    expect(Number.isNaN(Date.parse(graph.generatedAt))).toBe(false);
  });
});
