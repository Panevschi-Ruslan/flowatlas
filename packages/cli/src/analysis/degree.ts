import { byId, type AnalysisGraph } from './graph.js';

/** One node and everything that points at it. */
export interface DegreeRow {
  id: string;
  type: string;
  service: string;
  label: string;
  inDegree: number;
  /** Distinct services an incoming edge starts in, ascending. */
  callerServices: string[];
  /** How many of the incoming edges each type accounts for. */
  byEdgeType: Record<string, number>;
}

export interface DegreeOptions {
  /** Node types to rank. Everything is ranked when this is empty. */
  types?: readonly string[];
  /** Rank by how many services reach the node rather than by how many edges. */
  crossService?: boolean;
}

/**
 * Everything with something pointing at it, most depended upon first.
 *
 * In-degree is the whole measure on purpose: a node forty things call is
 * fragile in a way that is easy to explain and easy to check, and a ranking an
 * agent cannot explain is a ranking it will not act on. The secondary key is
 * how many services reach it, because a provider three repositories depend on
 * is a different problem from one called three times next door.
 */
export const inDegree = (graph: AnalysisGraph, options: DegreeOptions = {}): DegreeRow[] => {
  const wanted = new Set(options.types ?? []);
  const rows: DegreeRow[] = [];

  for (const id of graph.order) {
    const node = graph.nodes.get(id)!;
    if (wanted.size > 0 && !wanted.has(node.type)) continue;
    const incoming = graph.in.get(id) ?? [];
    if (incoming.length === 0) continue;

    const services = new Set<string>();
    const byEdgeType: Record<string, number> = {};
    for (const edge of incoming) {
      const service = graph.nodes.get(edge.from)?.service ?? '';
      if (service !== '') services.add(service);
      byEdgeType[edge.type] = (byEdgeType[edge.type] ?? 0) + 1;
    }

    rows.push({
      id,
      type: node.type,
      service: node.service,
      label: node.label,
      inDegree: incoming.length,
      callerServices: [...services].sort(byId),
      byEdgeType: Object.fromEntries(Object.entries(byEdgeType).sort(([a], [b]) => byId(a, b))),
    });
  }

  const primary = (row: DegreeRow): number =>
    options.crossService === true ? row.callerServices.length : row.inDegree;
  const secondary = (row: DegreeRow): number =>
    options.crossService === true ? row.inDegree : row.callerServices.length;

  return rows.sort(
    (a, b) => primary(b) - primary(a) || secondary(b) - secondary(a) || byId(a.id, b.id),
  );
};
