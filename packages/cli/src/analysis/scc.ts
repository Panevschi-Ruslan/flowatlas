import type { Confidence } from '@flowatlas/core';
import { byId, weakest, type AnalysisEdge, type AnalysisGraph } from './graph.js';

/** One hop of the cycle, as printed. `via` names the channel a hop stands for. */
export interface CycleHop {
  from: string;
  to: string;
  type: string;
  confidence: Confidence;
  via?: string;
}

/**
 * One strongly connected component, reported as a cycle.
 *
 * `nodes` is everything in the component; `edges` is one closed walk through
 * it, the shortest one through the starting node. A component with fifty nodes
 * has an enormous number of distinct cycles and listing them is exponential,
 * so one representative walk is what is shown.
 */
export interface Cycle {
  id: string;
  /** How many nodes are in the component, whatever `nodes` was cut to. */
  length: number;
  crossService: boolean;
  services: string[];
  /** The weakest hop of the representative walk. */
  confidence: Confidence;
  nodes: string[];
  /** Members left out of `nodes`; absent when nothing was. */
  truncatedNodes?: number;
  edges: CycleHop[];
  /** Hops left out of `edges`; absent when nothing was. */
  truncatedEdges?: number;
}

export interface SccOptions {
  /**
   * Smallest component reported. The default of 2 leaves out self recursion,
   * which is a legitimate shape rather than a finding.
   */
  minLength?: number;
  /** Members listed per cycle before `truncatedNodes` takes over. */
  maxNodes?: number;
  /** Hops shown per representative walk. */
  maxHops?: number;
}

const MAX_MEMBERS = 50;
const MAX_HOPS = 20;

/**
 * Tarjan's algorithm, iterative.
 *
 * Recursion would be the shorter way to write it and would run out of stack on
 * a real project: the graph of a five-repository monolith has call chains
 * hundreds deep.
 */
const components = (graph: AnalysisGraph): string[][] => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: string[][] = [];
  let counter = 0;

  for (const root of graph.order) {
    if (index.has(root)) continue;

    // Each frame remembers how far through its own successors it is, which is
    // what the call stack would have held.
    const frames: Array<{ id: string; next: number }> = [{ id: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const edges = graph.out.get(frame.id) ?? [];

      if (frame.next < edges.length) {
        const next = edges[frame.next]!.to;
        frame.next += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          frames.push({ id: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(next)!));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const members: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          members.push(popped);
          if (popped === frame.id) break;
        }
        found.push(members.sort(byId));
      }
    }
  }

  return found;
};

/** Successors of a node that stay inside the component, in id order. */
const inside = (graph: AnalysisGraph, id: string, members: ReadonlySet<string>): AnalysisEdge[] =>
  (graph.out.get(id) ?? []).filter((edge) => members.has(edge.to));

/**
 * The shortest closed walk through one node of the component.
 *
 * Breadth first, so the walk is the shortest there is and reads as the sentence
 * someone would write on a whiteboard. Successors are taken in id order, which
 * is what makes two runs agree on which of several equally short walks is shown.
 */
const walkThrough = (
  graph: AnalysisGraph,
  start: string,
  members: ReadonlySet<string>,
): AnalysisEdge[] => {
  const cameBy = new Map<string, AnalysisEdge>();
  const queue = [start];
  let closing: AnalysisEdge | undefined;

  while (queue.length > 0 && closing === undefined) {
    const id = queue.shift()!;
    for (const edge of inside(graph, id, members)) {
      if (edge.to === start) {
        closing = edge;
        break;
      }
      if (cameBy.has(edge.to)) continue;
      cameBy.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  if (closing === undefined) return [];

  const hops = [closing];
  let at = closing.from;
  while (at !== start) {
    const edge = cameBy.get(at)!;
    hops.unshift(edge);
    at = edge.from;
  }
  return hops;
};

const serviceOf = (graph: AnalysisGraph, id: string): string => graph.nodes.get(id)?.service ?? '';

/**
 * Where the walk should start, so a cross-service cycle reads as A → B → A.
 *
 * Starting anywhere gives the same cycle; starting at a node that leaves its
 * own service puts the boundary crossing at the front, which is the hop the
 * reader is looking for.
 */
const startOf = (graph: AnalysisGraph, members: string[]): string => {
  const set = new Set(members);
  for (const id of members) {
    const service = serviceOf(graph, id);
    if (inside(graph, id, set).some((edge) => serviceOf(graph, edge.to) !== service)) return id;
  }
  return members[0]!;
};

/**
 * Every cycle in the graph, largest concern first.
 *
 * Cross-service cycles come first because those are the ones nobody can see
 * from inside one repository, and within a group the ones proven entirely by
 * the type system come before the ones that rest on a guess.
 */
export const tarjanScc = (graph: AnalysisGraph, options: SccOptions = {}): Cycle[] => {
  const minLength = options.minLength ?? 2;
  const maxNodes = options.maxNodes ?? MAX_MEMBERS;
  const maxHops = options.maxHops ?? MAX_HOPS;
  const cycles: Cycle[] = [];

  for (const members of components(graph)) {
    const set = new Set(members);
    // A component of one is a cycle only when the node reaches itself.
    if (members.length === 1 && inside(graph, members[0]!, set).length === 0) continue;
    if (members.length < minLength) continue;

    const hops = walkThrough(graph, startOf(graph, members), set);
    if (hops.length === 0) continue;

    const services = [...new Set(members.map((id) => serviceOf(graph, id)))].filter(
      (name) => name !== '',
    );
    services.sort(byId);

    const shownNodes = members.slice(0, maxNodes);
    const shownHops = hops.slice(0, maxHops);

    cycles.push({
      id: members[0]!,
      length: members.length,
      crossService: services.length > 1,
      services,
      confidence: weakest(hops.map((hop) => hop.confidence)),
      nodes: shownNodes,
      ...(members.length > shownNodes.length ? { truncatedNodes: members.length - shownNodes.length } : {}),
      edges: shownHops.map((hop) => ({
        from: hop.from,
        to: hop.to,
        type: hop.type,
        confidence: hop.confidence,
        ...(hop.via === undefined ? {} : { via: hop.via }),
      })),
      ...(hops.length > shownHops.length ? { truncatedEdges: hops.length - shownHops.length } : {}),
    });
  }

  return cycles.sort(
    (a, b) =>
      Number(b.crossService) - Number(a.crossService) ||
      Number(b.confidence === 'static') - Number(a.confidence === 'static') ||
      a.length - b.length ||
      byId(a.id, b.id),
  );
};
