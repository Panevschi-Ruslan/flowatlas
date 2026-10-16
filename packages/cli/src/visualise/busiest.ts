import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { inDegree } from '../analysis/degree.js';
import { buildGraph } from '../analysis/graph.js';
import { HOTSPOT_EDGES } from '../commands/hotspots.js';

/**
 * The methods most things lean on, for the Busiest view (P73).
 *
 * The ranking is `flowatlas hotspots`' own: in-degree over the same edges,
 * broken by how many services reach it. To that the page adds what a reader
 * asks next - how many ways in reach the method, and how far from the
 * nearest one it sits - and splits the edges into the ones from its own
 * service and all of them.
 *
 * One row per method, `[node, total, own, services, waysIn, depth]`; `node`
 * is a packed position, `depth` the fewest steps from a way in, -1 for none.
 */
export type BusiestRow = [node: number, total: number, own: number, services: number, waysIn: number, depth: number];

export interface PackedBusiest {
  rows: BusiestRow[];
  /** How many methods have anything pointing at them, of which `rows` are the first. */
  ranked: number;
}

/** What a waterfall follows from a way in: what runs next, not what is imported. */
const REACHES: ReadonlySet<string> = new Set(['handles', 'calls', 'http_calls', 'hits', 'emits', 'consumes', 'triggers']);

/** What a request or a press comes in through: a way in, or a front end's action. */
const DOORS: ReadonlySet<string> = new Set(['entry', 'ui_action']);

const BUSIEST_TYPES = ['method', 'function'] as const;

export const BUSIEST_LIMIT = 60;

/** From every way in, breadth first: how many reach each node, and from how near. */
const reachFromEntries = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { ways: Map<string, number>; depth: Map<string, number> } => {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (!REACHES.has(edge.type)) continue;
    const list = out.get(edge.from);
    if (list === undefined) out.set(edge.from, [edge.to]);
    else list.push(edge.to);
  }
  const ways = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const entry of nodes) {
    if (!DOORS.has(entry.type)) continue;
    const at = new Map([[entry.id, 0]]);
    const queue = [entry.id];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head] as string;
      const hops = at.get(id) as number;
      for (const next of out.get(id) ?? []) {
        if (at.has(next)) continue;
        at.set(next, hops + 1);
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

export const packBusiest = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  position: ReadonlyMap<string, number>,
  limit = BUSIEST_LIMIT,
): PackedBusiest => {
  const wanted = new Set<string>(HOTSPOT_EDGES);
  const graph = buildGraph(
    nodes.map((node) => ({ id: node.id, type: node.type, label: node.label, service: node.repo })),
    edges
      .filter((edge) => wanted.has(edge.type))
      .map((edge) => ({ from: edge.from, to: edge.to, type: edge.type, confidence: edge.confidence })),
  );
  const ranked = inDegree(graph, { types: BUSIEST_TYPES });
  const { ways, depth } = reachFromEntries(nodes, edges);
  const rows = ranked.slice(0, limit).map((row): BusiestRow => {
    const own = (graph.in.get(row.id) ?? []).filter((edge) => graph.nodes.get(edge.from)?.service === row.service).length;
    return [
      position.get(row.id) as number,
      row.inDegree,
      own,
      row.callerServices.length,
      ways.get(row.id) ?? 0,
      depth.get(row.id) ?? -1,
    ];
  });
  return { rows, ranked: ranked.length };
};
