import type { Confidence, GraphEdge } from '@flowatlas/core';
import { CONFIDENCE_RANK, NODE_TYPES } from '@flowatlas/core';
import type { GraphDb } from '@flowatlas/linker';

/** As much of a node as an analysis needs; the rest is fetched by id. */
export interface AnalysisNode {
  id: string;
  type: string;
  kind?: string;
  label: string;
  service: string;
  file?: string;
  line?: number;
}

/**
 * An edge as an analysis walks it.
 *
 * `via` is set only on the synthetic hop that replaces a channel, and names the
 * channel it stands for, so a cycle can still say how the two ends met.
 */
export interface AnalysisEdge {
  from: string;
  to: string;
  type: string;
  confidence: Confidence;
  via?: string;
}

/**
 * The whole edge set, in memory, both ways round.
 *
 * Strongly connected components and in-degree both need every edge at once, so
 * the database is read once and the walks are done here. Everything is kept in
 * id order: the same graph must produce the same answer on every machine.
 */
export interface AnalysisGraph {
  nodes: Map<string, AnalysisNode>;
  out: Map<string, AnalysisEdge[]>;
  in: Map<string, AnalysisEdge[]>;
  /** Every node id, ascending. Iterate this, never a Map. */
  order: string[];
}

export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ranked by how much it can be trusted, so a walk can take the weakest hop. */
export const weakest = (levels: readonly Confidence[]): Confidence =>
  levels.length === 0
    ? 'static'
    : levels.reduce((worst, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[worst] ? level : worst));

const sortEdges = (edges: AnalysisEdge[]): AnalysisEdge[] =>
  edges.sort((a, b) => byId(a.to, b.to) || byId(a.from, b.from) || byId(a.type, b.type));

/** Builds the two adjacency maps from plain arrays, for a test or a reader. */
export const buildGraph = (
  nodes: readonly AnalysisNode[],
  edges: readonly AnalysisEdge[],
): AnalysisGraph => {
  const index = new Map<string, AnalysisNode>();
  for (const node of nodes) index.set(node.id, node);

  const out = new Map<string, AnalysisEdge[]>();
  const into = new Map<string, AnalysisEdge[]>();
  const add = (map: Map<string, AnalysisEdge[]>, key: string, edge: AnalysisEdge): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [edge]);
    else list.push(edge);
  };
  for (const edge of edges) {
    // An edge to a node the adjacency does not hold is not walkable. Nothing is
    // lost by it: the dead and config analyses read their own edges straight
    // from the database rather than from here.
    if (!index.has(edge.from) || !index.has(edge.to)) continue;
    add(out, edge.from, edge);
    add(into, edge.to, edge);
  }
  for (const list of out.values()) sortEdges(list);
  for (const list of into.values()) sortEdges(list);

  return { nodes: index, out, in: into, order: [...index.keys()].sort(byId) };
};

export interface LoadOptions {
  /** Edge types the adjacency keeps. Everything else is left in the database. */
  edgeTypes: readonly string[];
  /**
   * Replace `producer -emits-> channel -consumes-> consumer` with one hop.
   *
   * A cycle that runs through a message reads as "A publishes, B handles, B
   * calls A", and the channel node in the middle of it is bookkeeping rather
   * than a step. Off for anything counting edges, where the channel is a real
   * node with real ends.
   */
  collapseChannels?: boolean;
}

const toEdge = (edge: GraphEdge): AnalysisEdge => ({
  from: edge.from,
  to: edge.to,
  type: edge.type,
  confidence: edge.confidence,
});

/**
 * Reads every node and every edge of the requested types.
 *
 * One statement per node rather than one for the lot: the reader exposes edges
 * by node, and an indexed lookup repeated a few thousand times costs less than
 * the analyses that follow it.
 */
export const loadGraph = (db: GraphDb, options: LoadOptions): AnalysisGraph => {
  const wanted = new Set(options.edgeTypes);
  const collapse = options.collapseChannels === true;
  const nodes: AnalysisNode[] = [];
  const edges: AnalysisEdge[] = [];

  for (const type of NODE_TYPES) {
    if (collapse && type === 'channel') continue;
    for (const node of db.nodesByType(type)) {
      nodes.push({
        id: node.id,
        type: node.type,
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        label: node.label,
        service: node.repo,
        ...(node.file === undefined ? {} : { file: node.file }),
        ...(node.line === undefined ? {} : { line: node.line }),
      });
    }
  }

  for (const node of nodes) {
    for (const edge of db.edgesFrom(node.id)) {
      if (wanted.has(edge.type)) edges.push(toEdge(edge));
    }
  }

  if (collapse) {
    for (const channel of db.nodesByType('channel')) {
      const producers = db.edgesTo(channel.id, ['emits']);
      const consumers = db.edgesFrom(channel.id, ['consumes']);
      for (const publish of producers) {
        for (const handle of consumers) {
          edges.push({
            from: publish.from,
            to: handle.to,
            type: 'channel',
            confidence: weakest([publish.confidence, handle.confidence]),
            via: channel.id,
          });
        }
      }
    }
  }

  return buildGraph(nodes, edges);
};

/**
 * Which class each method belongs to.
 *
 * A method id is its class id plus `.name`, and nothing else in the grammar
 * ends that way, so the owner is recoverable without another table. Needed
 * because the graph has no edge from a class to its own methods: a guard is
 * reached as a class and reads its settings inside a method.
 */
export const methodsByOwner = (db: GraphDb): Map<string, string[]> => {
  const owners = new Map<string, string[]>();
  for (const method of db.nodesByType('method')) {
    const cut = method.id.lastIndexOf('.');
    if (cut <= 0) continue;
    const owner = method.id.slice(0, cut);
    const list = owners.get(owner);
    if (list === undefined) owners.set(owner, [method.id]);
    else list.push(method.id);
  }
  for (const list of owners.values()) list.sort(byId);
  return owners;
};
