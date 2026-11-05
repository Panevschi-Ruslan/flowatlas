import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { atLevel, toCsv, toCypher, toDot, toGraphML } from './graph-formats.js';

const node = (id: string, repo: string, type = 'method'): GraphNode => ({ id, type, label: id.split(':').pop() ?? id, repo }) as GraphNode;
const edge = (from: string, to: string, type: string, confidence = 'static', meta?: Record<string, unknown>): GraphEdge =>
  ({ from, to, type, confidence, ...(meta === undefined ? {} : { meta }) }) as GraphEdge;

/** A browser calling a gateway by a best guess, twice, and the gateway calling orders. */
const GRAPH = {
  nodes: [
    node('web#a.ts:Cart.save', 'web'),
    node('web#a.ts:Cart.load', 'web'),
    node('entry:gateway:http:POST:/cart', 'gateway', 'entry'),
    node('gateway#c.ts:CartController.save', 'gateway'),
    node('entry:orders:http:POST:/orders', 'orders', 'entry'),
  ],
  edges: [
    edge('web#a.ts:Cart.save', 'entry:gateway:http:POST:/cart', 'hits', 'heuristic'),
    edge('web#a.ts:Cart.load', 'entry:gateway:http:POST:/cart', 'hits', 'static', { observed: 3 }),
    edge('entry:gateway:http:POST:/cart', 'gateway#c.ts:CartController.save', 'handles'),
    edge('gateway#c.ts:CartController.save', 'entry:orders:http:POST:/orders', 'http_calls', 'marker'),
  ],
};

describe('the graph in open formats (P237)', () => {
  it('sums a level’s edges, as sure as the least sure of them, seen when any was', () => {
    const { units, edges } = atLevel(GRAPH, 'service');
    expect(units.map((unit) => unit.id)).toEqual(['service:gateway', 'service:orders', 'service:web']);
    expect(edges).toEqual([
      { from: 'service:gateway', to: 'service:orders', type: 'http_calls', count: 1, confidence: 'marker', observed: false },
      { from: 'service:web', to: 'service:gateway', type: 'hits', count: 2, confidence: 'heuristic', observed: true },
    ]);
    expect(atLevel(GRAPH, 'class').units.map((unit) => unit.id)).toContain('web#a.ts:Cart');
  });

  it('draws DOT with a line style for how sure each edge is', () => {
    const [file] = toDot(GRAPH, 'service', 'shop');
    expect(file?.path).toBe('graph.service.dot');
    expect(file?.text).toContain('"service:web" -> "service:gateway" [label="hits 2", style="dashed,bold", confidence="heuristic"];');
    expect(file?.text).toContain('style="dotted"');
    expect(toDot(GRAPH, 'node')[0]?.text).toContain('subgraph cluster_0 {');
  });

  it('declares its GraphML keys and carries confidence on every edge', () => {
    const [file] = toGraphML(GRAPH, 'node');
    expect(file?.text).toContain('<key id="e_confidence" for="edge" attr.name="confidence" attr.type="string"/>');
    expect(file?.text.match(/<edge /g)).toHaveLength(4);
    expect(file?.text).toContain('<data key="e_confidence">heuristic</data>');
  });

  it('writes Cypher that MERGEs, so running it twice changes nothing', () => {
    const [file] = toCypher(GRAPH, 'node', 2);
    expect(file?.text).toContain('CREATE CONSTRAINT flowatlas_id IF NOT EXISTS');
    expect(file?.text).not.toMatch(/\bCREATE \(/);
    expect(file?.text).toContain("MERGE (a)-[r:HITS]->(b) SET r.confidence = row.confidence");
    // Batched by the size asked: two web methods in one, the gateway's in another.
    expect(file?.text.match(/^UNWIND/gm)?.length).toBeGreaterThanOrEqual(4);
  });

  it('writes two CSV files in neo4j-admin’s header form, quoting what needs it', () => {
    const files = toCsv({ ...GRAPH, nodes: [...GRAPH.nodes, { id: 'x', type: 'method', label: 'a, "b"', repo: 'web' } as GraphNode] }, 'node');
    expect(files.map((file) => file.path)).toEqual(['nodes.node.csv', 'edges.node.csv']);
    expect(files[0]?.text.split('\n')[0]).toBe('id:ID,label,type,service,:LABEL');
    expect(files[0]?.text).toContain('x,"a, ""b""",method,web,Method');
    expect(files[1]?.text).toContain('web#a.ts:Cart.save,entry:gateway:http:POST:/cart,HITS,heuristic,1,false');
  });
});
