import { describe, expect, it } from 'vitest';
import { buildGraph, loadGraph, type AnalysisEdge, type AnalysisNode } from './graph.js';
import { tarjanScc } from './scc.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const at = (id: string, service: string, type = 'method'): AnalysisNode => ({
  id,
  type,
  label: id,
  service,
});

const hop = (from: string, to: string, over: Partial<AnalysisEdge> = {}): AnalysisEdge => ({
  from,
  to,
  type: 'calls',
  confidence: 'static',
  ...over,
});

describe('finding cycles', () => {
  it('reports a component of two nodes and leaves a straight chain alone', () => {
    const graph = buildGraph(
      [at('a', 'orders'), at('b', 'orders'), at('c', 'orders')],
      [hop('a', 'b'), hop('b', 'a'), hop('b', 'c')],
    );

    const cycles = tarjanScc(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.nodes).toEqual(['a', 'b']);
    expect(cycles[0]!.length).toBe(2);
    expect(cycles[0]!.crossService).toBe(false);
  });

  it('gives a representative walk that really closes on itself', () => {
    const graph = buildGraph(
      [at('a', 'orders'), at('b', 'orders'), at('c', 'orders'), at('d', 'orders')],
      [hop('a', 'b'), hop('b', 'c'), hop('c', 'a'), hop('c', 'd'), hop('d', 'b')],
    );

    const [cycle] = tarjanScc(graph);
    const hops = cycle!.edges;
    expect(hops.length).toBeGreaterThan(1);
    expect(hops[0]!.from).toBe(hops[hops.length - 1]!.to);
    for (let index = 1; index < hops.length; index += 1) {
      expect(hops[index]!.from).toBe(hops[index - 1]!.to);
    }
  });

  it('takes the shortest walk through the component, not the first one found', () => {
    const graph = buildGraph(
      [at('a', 'orders'), at('b', 'orders'), at('c', 'orders'), at('d', 'orders')],
      [hop('a', 'b'), hop('b', 'a'), hop('b', 'c'), hop('c', 'd'), hop('d', 'a')],
    );

    const [cycle] = tarjanScc(graph);
    expect(cycle!.edges).toHaveLength(2);
  });

  it('leaves a self-loop out until the smallest length is lowered to one', () => {
    const graph = buildGraph([at('a', 'orders')], [hop('a', 'a')]);

    expect(tarjanScc(graph)).toHaveLength(0);
    expect(tarjanScc(graph, { minLength: 1 })).toHaveLength(1);
  });

  it('says a cycle is cross-service and names every service in it', () => {
    const graph = buildGraph(
      [at('a', 'gateway'), at('b', 'orders')],
      [hop('a', 'b', { type: 'http_calls' }), hop('b', 'a', { type: 'http_calls' })],
    );

    const [cycle] = tarjanScc(graph);
    expect(cycle!.crossService).toBe(true);
    expect(cycle!.services).toEqual(['gateway', 'orders']);
  });

  it('takes the weakest hop of the walk as the confidence of the cycle', () => {
    const graph = buildGraph(
      [at('a', 'orders'), at('b', 'orders')],
      [hop('a', 'b'), hop('b', 'a', { confidence: 'heuristic' })],
    );

    expect(tarjanScc(graph)[0]!.confidence).toBe('heuristic');
  });

  it('puts cross-service cycles first and proven ones before guessed ones', () => {
    const nodes = [
      at('a', 'gateway'),
      at('b', 'orders'),
      at('c', 'orders'),
      at('d', 'orders'),
      at('e', 'billing'),
      at('f', 'orders'),
    ];
    const graph = buildGraph(nodes, [
      // cross-service, but resting on a guess
      hop('a', 'b'),
      hop('b', 'a', { confidence: 'heuristic' }),
      // inside one service, proven
      hop('c', 'd'),
      hop('d', 'c'),
      // cross-service and proven
      hop('e', 'f'),
      hop('f', 'e'),
    ]);

    expect(tarjanScc(graph).map((cycle) => cycle.id)).toEqual(['e', 'a', 'c']);
  });

  it('cuts a large component down and says how much it left out', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `n${String(index).padStart(2, '0')}`);
    const graph = buildGraph(
      ids.map((id) => at(id, 'orders')),
      ids.map((id, index) => hop(id, ids[(index + 1) % ids.length]!)),
    );

    const [cycle] = tarjanScc(graph, { maxNodes: 50, maxHops: 20 });
    expect(cycle!.length).toBe(60);
    expect(cycle!.nodes).toHaveLength(50);
    expect(cycle!.truncatedNodes).toBe(10);
    expect(cycle!.edges).toHaveLength(20);
    expect(cycle!.truncatedEdges).toBe(40);
  });

  it('answers the same way whichever order the edges arrive in', () => {
    const nodes = [at('a', 'orders'), at('b', 'orders'), at('c', 'orders')];
    const edges = [hop('a', 'b'), hop('b', 'c'), hop('c', 'a')];
    const forwards = tarjanScc(buildGraph(nodes, edges));
    const backwards = tarjanScc(buildGraph([...nodes].reverse(), [...edges].reverse()));

    expect(backwards).toEqual(forwards);
  });
});

describe('collapsing a channel into one hop', () => {
  const graph = {
    nodes: [
      node('orders#a:A.publish'),
      node('producer:orders#a:1:1', { type: 'producer', label: 'event x' }),
      node('channel:x', { type: 'channel', label: 'x', repo: 'orders' }),
      node('consumer:billing#b:B.handle', { type: 'consumer', repo: 'billing' }),
      node('billing#b:B.handle', { repo: 'billing' }),
    ],
    edges: [
      edge('orders#a:A.publish', 'producer:orders#a:1:1'),
      edge('producer:orders#a:1:1', 'channel:x', { type: 'emits' }),
      edge('channel:x', 'consumer:billing#b:B.handle', { type: 'consumes', confidence: 'marker' }),
      edge('consumer:billing#b:B.handle', 'billing#b:B.handle', { type: 'handles' }),
    ],
  };

  it('joins the publisher straight to the handler and remembers the channel', () => {
    const db = buildTestDb(graph);
    const loaded = loadGraph(db, {
      edgeTypes: ['calls', 'handles'],
      collapseChannels: true,
    });
    db.close();

    expect(loaded.nodes.has('channel:x')).toBe(false);
    const [collapsed] = loaded.out.get('producer:orders#a:1:1')!;
    expect(collapsed).toMatchObject({
      to: 'consumer:billing#b:B.handle',
      type: 'channel',
      via: 'channel:x',
      // The hop is worth no more than the weaker of the two it replaces.
      confidence: 'marker',
    });
  });

  it('keeps the channel as a node of its own when nothing is being collapsed', () => {
    const db = buildTestDb(graph);
    const loaded = loadGraph(db, { edgeTypes: ['emits', 'consumes'] });
    db.close();

    expect(loaded.nodes.has('channel:x')).toBe(true);
    expect(loaded.in.get('channel:x')).toHaveLength(1);
  });
});

describe('following injects only when asked', () => {
  const graph = {
    nodes: [node('orders#p:X', { type: 'provider' }), node('orders#p:Y', { type: 'provider' })],
    edges: [
      edge('orders#p:X', 'orders#p:Y', { type: 'injects' }),
      edge('orders#p:Y', 'orders#p:X', { type: 'injects' }),
    ],
  };

  it('leaves a forwardRef pair out of the default edge set', () => {
    const db = buildTestDb(graph);
    const without = tarjanScc(loadGraph(db, { edgeTypes: ['calls'], collapseChannels: true }));
    const with_ = tarjanScc(
      loadGraph(db, { edgeTypes: ['calls', 'injects'], collapseChannels: true }),
    );
    db.close();

    expect(without).toHaveLength(0);
    expect(with_).toHaveLength(1);
  });
});
