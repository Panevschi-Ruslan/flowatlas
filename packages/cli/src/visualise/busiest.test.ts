import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { packBusiest, reachOfRows } from './busiest.js';

const REACHES = new Set(['handles', 'calls', 'http_calls', 'hits', 'emits', 'consumes', 'triggers']);
const DOORS = new Set(['entry', 'ui_action']);

/**
 * The walk P73 shipped, kept as the oracle: a breadth-first search forward
 * from every way in over the whole graph, filling both numbers for every node.
 */
const oracle = (nodes: readonly GraphNode[], edges: readonly GraphEdge[]) => {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (!REACHES.has(edge.type)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
  }
  const ways = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const entry of nodes) {
    if (!DOORS.has(entry.type)) continue;
    const at = new Map([[entry.id, 0]]);
    const queue = [entry.id];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head]!;
      for (const next of out.get(id) ?? []) {
        if (at.has(next)) continue;
        at.set(next, at.get(id)! + 1);
        queue.push(next);
      }
    }
    for (const [id, hops] of at) {
      if (id === entry.id) continue;
      ways.set(id, (ways.get(id) ?? 0) + 1);
      const was = depth.get(id);
      if (was === undefined || hops < was) depth.set(id, hops);
    }
  }
  return { ways, depth };
};

/** A small linear congruential generator, so the graph is the same on every run. */
const random = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

/** Doors, methods and functions across three services, with cycles and edges of every kind. */
const generated = (seed: number): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const next = random(seed);
  const types = ['entry', 'ui_action', 'method', 'method', 'method', 'function', 'provider', 'channel'];
  const nodes: GraphNode[] = Array.from({ length: 90 }, (_, i) => {
    const type = types[Math.floor(next() * types.length)]!;
    return { id: `n${i}`, type, label: `${type}${i}`, repo: `svc${i % 3}` } as GraphNode;
  });
  const kinds = ['handles', 'calls', 'calls', 'http_calls', 'hits', 'emits', 'consumes', 'triggers', 'injects', 'imports'];
  const edges: GraphEdge[] = Array.from({ length: 260 }, () => ({
    from: nodes[Math.floor(next() * nodes.length)]!.id,
    to: nodes[Math.floor(next() * nodes.length)]!.id,
    type: kinds[Math.floor(next() * kinds.length)]!,
    confidence: 'static',
  })) as GraphEdge[];
  // A cycle through a way in, and a way in that another way in reaches.
  edges.push(
    { from: 'n1', to: 'n2', type: 'calls', confidence: 'static' } as GraphEdge,
    { from: 'n2', to: 'n1', type: 'calls', confidence: 'static' } as GraphEdge,
  );
  return { nodes, edges };
};

describe('Busiest reach, worked out for the rows shown (P84)', () => {
  it('gives every node the numbers the forward walk from every way in gave, on graphs with cycles', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const { nodes, edges } = generated(seed);
      const old = oracle(nodes, edges);
      const reach = reachOfRows(nodes.map((node) => node.id), nodes, edges);
      for (const node of nodes) {
        expect(reach.get(node.id), `${seed} ${node.id}`).toEqual({
          ways: old.ways.get(node.id) ?? 0,
          depth: old.depth.get(node.id) ?? -1,
        });
      }
    }
  });

  it('ranks the same rows with the same numbers, at most `limit` of them', () => {
    for (const seed of [3, 11]) {
      const { nodes, edges } = generated(seed);
      const position = new Map(nodes.map((node, i) => [node.id, i]));
      const old = oracle(nodes, edges);
      const { rows, ranked } = packBusiest(nodes, edges, position, 10);
      expect(rows.length).toBe(Math.min(10, ranked));
      for (const [at, , , , ways, depth] of rows) {
        const id = nodes[at]!.id;
        expect([ways, depth]).toEqual([old.ways.get(id) ?? 0, old.depth.get(id) ?? -1]);
      }
    }
  });

  it('searches once per row asked about, and only from those', () => {
    const { nodes, edges } = generated(5);
    expect([...reachOfRows(['n3', 'n4'], nodes, edges).keys()]).toEqual(['n3', 'n4']);
    expect(reachOfRows([], nodes, edges).size).toBe(0);
  });
});
