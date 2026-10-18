import { rowKindOf, waysInOf, type GraphEdge, type GraphNode, type KindedRow } from '@flowatlas/core';
import { inDegree } from '../analysis/degree.js';
import { buildGraph } from '../analysis/graph.js';
import { HOTSPOT_EDGES } from '../analysis/hotspots.js';

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
  /**
   * The likely N+1 loops (P89), `[row, waysIn]`: `row` a position in the
   * packed rows, reached from the most ways in first, then by place. A loop
   * that is per item on purpose (a note) is not among them.
   */
  loops: Array<[row: number, waysIn: number]>;
}

/** A row as the pack is handed it, as far as ranking a loop needs. */
type LoopRow = KindedRow & { file?: string | null; line?: number | null };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The likely N+1 rows, by position, the way doctor lists them (P89). */
export const likelyLoops = (rows: readonly LoopRow[]): PackedBusiest['loops'] =>
  rows
    .flatMap((row, index) => (row.reason === 'query-in-loop' && rowKindOf(row) === 'finding' ? [index] : []))
    .sort((a, b) => {
      const ra = rows[a] as LoopRow;
      const rb = rows[b] as LoopRow;
      return (
        (waysInOf(rb) ?? 0) - (waysInOf(ra) ?? 0) || cmp(ra.file ?? '', rb.file ?? '') || (ra.line ?? 0) - (rb.line ?? 0)
      );
    })
    .map((index) => [index, waysInOf(rows[index] as LoopRow) ?? 0]);

/** What a waterfall follows from a way in: what runs next, not what is imported. */
const REACHES: ReadonlySet<string> = new Set(['handles', 'calls', 'http_calls', 'hits', 'emits', 'consumes', 'triggers']);

/** What a request or a press comes in through: a way in, or a front end's action. */
const DOORS: ReadonlySet<string> = new Set(['entry', 'ui_action']);

const BUSIEST_TYPES = ['method', 'function'] as const;

export const BUSIEST_LIMIT = 60;

/**
 * For each of `ids`, how many ways in reach it and from how near, by one
 * breadth-first search backwards from it (P84).
 *
 * Asked of the rows the view shows rather than worked out from every way in to
 * every node: the cost is the rows times what lies upstream of each, where the
 * forward walk it replaced was every way in times everything downstream. The
 * numbers are the same. A way in is counted once however many paths it has,
 * the search goes on through a way in as the forward walk went on from one,
 * and a node is not its own way in (the search starts there). `depth` is the
 * fewest steps from the nearest, -1 when none reaches it.
 */
export const reachOfRows = (
  ids: readonly string[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Map<string, { ways: number; depth: number }> => {
  const into = new Map<string, string[]>();
  for (const edge of edges) {
    if (!REACHES.has(edge.type)) continue;
    const list = into.get(edge.to);
    if (list === undefined) into.set(edge.to, [edge.from]);
    else list.push(edge.from);
  }
  const doors = new Set(nodes.filter((node) => DOORS.has(node.type)).map((node) => node.id));
  const out = new Map<string, { ways: number; depth: number }>();
  for (const id of ids) {
    const at = new Map([[id, 0]]);
    const queue = [id];
    let ways = 0;
    let depth = -1;
    for (let head = 0; head < queue.length; head += 1) {
      const from = queue[head] as string;
      const hops = at.get(from) as number;
      for (const next of into.get(from) ?? []) {
        if (at.has(next)) continue;
        at.set(next, hops + 1);
        queue.push(next);
        if (!doors.has(next)) continue;
        ways += 1;
        // Breadth first, so the first way in met is the nearest.
        if (depth === -1) depth = hops + 1;
      }
    }
    out.set(id, { ways, depth });
  }
  return out;
};

export const packBusiest = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  position: ReadonlyMap<string, number>,
  rows: readonly LoopRow[] = [],
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
  const shown = ranked.slice(0, limit);
  const reach = reachOfRows(shown.map((row) => row.id), nodes, edges);
  const methods = shown.map((row): BusiestRow => {
    const { ways, depth } = reach.get(row.id) as { ways: number; depth: number };
    const own = (graph.in.get(row.id) ?? []).filter((edge) => graph.nodes.get(edge.from)?.service === row.service).length;
    return [
      position.get(row.id) as number,
      row.inDegree,
      own,
      row.callerServices.length,
      ways,
      depth,
    ];
  });
  return { rows: methods, ranked: ranked.length, loops: likelyLoops(rows) };
};
