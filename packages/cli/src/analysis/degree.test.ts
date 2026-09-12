import { describe, expect, it } from 'vitest';
import { inDegree } from './degree.js';
import { buildGraph, type AnalysisEdge, type AnalysisNode } from './graph.js';

const at = (id: string, service: string, type = 'method'): AnalysisNode => ({
  id,
  type,
  label: id,
  service,
});

const hop = (from: string, to: string, type = 'calls'): AnalysisEdge => ({
  from,
  to,
  type,
  confidence: 'static',
});

const graph = buildGraph(
  [
    at('target', 'orders', 'entry'),
    at('one', 'orders'),
    at('two', 'gateway'),
    at('three', 'billing'),
    at('quiet', 'orders'),
    at('other', 'orders', 'provider'),
  ],
  [
    hop('one', 'target'),
    hop('two', 'target', 'http_calls'),
    hop('three', 'target', 'http_calls'),
    hop('one', 'other', 'injects'),
  ],
);

describe('ranking by what points at a node', () => {
  it('counts every incoming edge and splits the count by edge type', () => {
    const [top] = inDegree(graph);
    expect(top).toMatchObject({
      id: 'target',
      inDegree: 3,
      byEdgeType: { calls: 1, http_calls: 2 },
    });
  });

  it('names each caller service once, in order', () => {
    expect(inDegree(graph)[0]!.callerServices).toEqual(['billing', 'gateway', 'orders']);
  });

  it('leaves out a node nothing points at', () => {
    expect(inDegree(graph).map((row) => row.id)).not.toContain('quiet');
  });

  it('narrows to the node types asked for', () => {
    expect(inDegree(graph, { types: ['provider'] }).map((row) => row.id)).toEqual(['other']);
  });

  it('breaks a tie by id, so two runs agree', () => {
    const tied = buildGraph(
      [at('b', 'orders'), at('a', 'orders'), at('caller', 'orders')],
      [hop('caller', 'b'), hop('caller', 'a')],
    );
    expect(inDegree(tied).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('puts the node most services reach first when asked to rank that way', () => {
    const wide = buildGraph(
      [
        at('spread', 'orders', 'entry'),
        at('busy', 'orders', 'entry'),
        at('g', 'gateway'),
        at('b', 'billing'),
        at('o1', 'orders'),
        at('o2', 'orders'),
        at('o3', 'orders'),
      ],
      [
        hop('g', 'spread'),
        hop('b', 'spread'),
        hop('o1', 'busy'),
        hop('o2', 'busy'),
        hop('o3', 'busy'),
      ],
    );

    expect(inDegree(wide).map((row) => row.id)).toEqual(['busy', 'spread']);
    expect(inDegree(wide, { crossService: true }).map((row) => row.id)).toEqual(['spread', 'busy']);
  });
});
