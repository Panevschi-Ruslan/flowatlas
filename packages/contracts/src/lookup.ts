/**
 * The graph, whichever form it arrives in.
 *
 * A check runs over a whole project graph held in memory, or over the database
 * a build wrote, or over a handful of nodes a test builds by hand. All three
 * answer the same five questions, so the check asks those five and knows about
 * none of the three.
 */
import type { GraphEdge, GraphNode, ProjectGraph, TypeEntry } from '@flowatlas/core';
import type { GraphLookup } from './types.js';

/** True for the in-memory graph, which is the one shape with arrays on it. */
export const isProjectGraph = (source: ProjectGraph | GraphLookup): source is ProjectGraph =>
  Array.isArray((source as ProjectGraph).nodes) && Array.isArray((source as ProjectGraph).edges);

/**
 * Indexes for a graph that is already in memory.
 *
 * Built once and thrown away with the check. Walking the edge array for every
 * question would turn a project with twenty thousand edges into a minute of
 * scanning, and the answers are the same either way.
 */
export const lookupOf = (graph: ProjectGraph): GraphLookup => {
  const nodes = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  const byType = new Map<string, GraphNode[]>();
  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();

  const push = (index: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void => {
    const list = index.get(key);
    if (list === undefined) index.set(key, [edge]);
    else list.push(edge);
  };

  for (const node of graph.nodes) {
    const list = byType.get(node.type);
    if (list === undefined) byType.set(node.type, [node]);
    else list.push(node);
  }
  for (const edge of graph.edges) {
    push(out, edge.from, edge);
    push(into, edge.to, edge);
  }

  const filtered = (edges: readonly GraphEdge[], types?: readonly string[]): GraphEdge[] =>
    types === undefined || types.length === 0
      ? [...edges]
      : edges.filter((edge) => types.includes(edge.type));

  return {
    node: (id) => nodes.get(id),
    edgesFrom: (id, types) => filtered(out.get(id) ?? [], types),
    edgesTo: (id, types) => filtered(into.get(id) ?? [], types),
    type: (id): TypeEntry | undefined => graph.types[id],
    allEdges: () => graph.edges,
    nodesByType: (type, kind) => {
      const found = byType.get(type) ?? [];
      return kind === undefined ? [...found] : found.filter((node) => node.kind === kind);
    },
    schemaVersion: () => graph.schemaVersion,
  };
};

/** Whichever was handed over, as the five questions a check asks. */
export const asLookup = (source: ProjectGraph | GraphLookup): GraphLookup =>
  isProjectGraph(source) ? lookupOf(source) : source;
