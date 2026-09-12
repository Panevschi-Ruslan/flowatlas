/**
 * Two project graphs, and what a pull request did to them.
 *
 * Pure: two graphs in, one answer out. Ids are path-based and therefore stable
 * across revisions (plan §5), which is the whole basis of this — without that
 * every rebuild would look like a rewrite.
 */
import type {
  GraphEdge,
  GraphNode,
  ProjectGraph,
  TypeEntry,
  TypeRegistry,
  Unresolved,
} from '@flowatlas/core';
import { compareDeclarations } from './compare-declarations.js';
import {
  changedEdgeFields,
  changedNodeFields,
  edgeFingerprint,
  nodeFingerprint,
} from './fingerprint.js';
import {
  edgeKeyOf,
  type DiffOptions,
  type EdgeChange,
  type EdgeRef,
  type GraphCounts,
  type GraphDiff,
  type NodeChange,
  type NodeDiff,
  type TypeChange,
  type TypeDiff,
  type UnresolvedCount,
} from './types.js';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const indexNodes = (nodes: readonly GraphNode[]): Map<string, GraphNode> =>
  new Map(nodes.map((node) => [node.id, node]));

/**
 * Edges by `from|type|to`.
 *
 * A repeated key is one edge as far as the diff is concerned: the graph does
 * deduplicate them, and two rows that would key alike differ only in where they
 * were written, which is not a change anybody can act on.
 */
const indexEdges = (edges: readonly GraphEdge[]): Map<string, GraphEdge> => {
  const found = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const key = edgeKeyOf(edge);
    if (!found.has(key)) found.set(key, edge);
  }
  return found;
};

const sites = (unresolved: readonly Unresolved[]): UnresolvedCount => ({
  rows: unresolved.length,
  sites: unresolved.reduce((sum, row) => sum + (row.sites ?? 1), 0),
});

const countsOf = (graph: ProjectGraph): GraphCounts => ({
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  types: Object.keys(graph.types).length,
  unresolved: sites(graph.unresolved),
});

const diffNodes = (base: ProjectGraph, head: ProjectGraph): NodeDiff => {
  const before = indexNodes(base.nodes);
  const after = indexNodes(head.nodes);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: NodeChange[] = [];
  const moved: string[] = [];

  for (const [id, node] of after) {
    const old = before.get(id);
    if (old === undefined) {
      added.push(id);
      continue;
    }
    if (nodeFingerprint(old) !== nodeFingerprint(node)) {
      changed.push({
        id,
        service: node.repo,
        label: node.label,
        fields: changedNodeFields(old, node),
      });
      continue;
    }
    // Same in every way but where it sits. Reported, because a reviewer looking
    // for a symbol wants the new line, and kept apart from a change, because
    // nothing about it changed.
    if ((old.line ?? null) !== (node.line ?? null)) moved.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);

  return {
    added: added.sort(byText),
    removed: removed.sort(byText),
    changed: changed.sort((a, b) => byText(a.id, b.id)),
    moved: moved.sort(byText),
  };
};

const refOf = (edge: GraphEdge): EdgeRef => ({ from: edge.from, to: edge.to, type: edge.type });

const diffEdges = (base: ProjectGraph, head: ProjectGraph): EdgeDiffResult => {
  const before = indexEdges(base.edges);
  const after = indexEdges(head.edges);
  const added: EdgeRef[] = [];
  const removed: EdgeRef[] = [];
  const changed: EdgeChange[] = [];

  for (const [key, edge] of after) {
    const old = before.get(key);
    if (old === undefined) {
      added.push(refOf(edge));
      continue;
    }
    if (edgeFingerprint(old) === edgeFingerprint(edge)) continue;
    changed.push({ key, ...refOf(edge), fields: changedEdgeFields(old, edge) });
  }
  for (const [key, edge] of before) if (!after.has(key)) removed.push(refOf(edge));

  const order = (a: EdgeRef, b: EdgeRef): number =>
    byText(edgeKeyOf(a), edgeKeyOf(b));
  return {
    added: added.sort(order),
    removed: removed.sort(order),
    changed: changed.sort((a, b) => byText(a.key, b.key)),
  };
};

type EdgeDiffResult = GraphDiff['edges'];

/**
 * Declarations added, removed and changed, by structural hash first.
 *
 * The hash is what §2.3 keeps for exactly this question, and it answers it
 * without reading a field. Which fields moved is a second question, and it is
 * asked of the comparator the caller handed over, because the rules of the JSON
 * wire live in `@flowatlas/contracts` and must be the same ones `flowatlas
 * contracts` applies — a field the wire drops is not a change to the wire.
 */
/**
 * The registry a nested reference is resolved against, and why it is one.
 *
 * Both declarations of a type carry the same id, so one lookup cannot answer
 * for both sides and a shape nested inside them is compared head against head.
 * That loses nothing: a nested declaration that changed has its own row in
 * `types.changed`, with its own field diff, which is where it belongs. What is
 * left on the outer row is the hash saying the shape differs somewhere.
 */
const comparator = (
  base: TypeRegistry,
  head: TypeRegistry,
  options: DiffOptions,
): ((old: TypeEntry, entry: TypeEntry, id: string) => TypeChange['fieldDiff']) => {
  if (options.compareTypes !== undefined) return options.compareTypes;
  const registry: TypeRegistry = { ...base, ...head };
  return (old, entry) =>
    compareDeclarations(old, entry, registry, {
      ...(options.depth === undefined ? {} : { depth: options.depth }),
      ...(options.disableRules === undefined ? {} : { disableRules: options.disableRules }),
    });
};

const diffTypes = (
  base: ProjectGraph,
  head: ProjectGraph,
  options: DiffOptions,
): TypeDiff => {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: TypeChange[] = [];
  const compare = comparator(base.types, head.types, options);

  for (const [id, entry] of Object.entries(head.types)) {
    const old: TypeEntry | undefined = base.types[id];
    if (old === undefined) {
      added.push(id);
      continue;
    }
    if (old.structuralHash === entry.structuralHash) continue;
    changed.push({
      id,
      name: entry.name,
      baseHash: old.structuralHash,
      headHash: entry.structuralHash,
      fieldDiff: compare(old, entry, id),
    });
  }
  for (const id of Object.keys(base.types)) if (head.types[id] === undefined) removed.push(id);

  return {
    added: added.sort(byText),
    removed: removed.sort(byText),
    changed: changed.sort((a, b) => byText(a.id, b.id)),
  };
};

/**
 * What changed between two revisions of one project.
 *
 * Every array comes out in a fixed order, because every row of the report
 * derives from one of them and a report that reshuffles itself between runs is
 * one nobody can diff.
 */
export const diffGraphs = (
  base: ProjectGraph,
  head: ProjectGraph,
  options: DiffOptions = {},
): GraphDiff => ({
  nodes: diffNodes(base, head),
  edges: diffEdges(base, head),
  types: diffTypes(base, head, options),
  counts: { base: countsOf(base), head: countsOf(head) },
});

/**
 * Every node the diff has something to say about, in the order to report them.
 *
 * Added nodes are deliberately not here: nothing reached them before, so "what
 * would notice" has no answer worth the row. Changed and removed both have one.
 */
export const impactedNodes = (diff: GraphDiff): Array<{ id: string; side: 'head' | 'base' }> => [
  ...diff.nodes.changed.map((node) => ({ id: node.id, side: 'head' as const })),
  ...diff.nodes.removed.map((id) => ({ id, side: 'base' as const })),
];
