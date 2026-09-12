import {
  GraphBuilder,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeEntry,
  type Unresolved,
} from '@flowatlas/core';

/**
 * Which file a graph element belongs to.
 *
 * An edge is owned by the file holding the call site or the annotation that
 * created it. Extractors set `file` on every edge they make; the file of the
 * node the edge leaves is the fallback for one that predates that rule, so a
 * missing value costs precision rather than crashing the splice.
 */
const ownerOfEdge = (edge: GraphEdge, nodes: ReadonlyMap<string, GraphNode>): string | undefined =>
  edge.file ?? nodes.get(edge.from)?.file;

/**
 * The file a type was declared in.
 *
 * `declaredIn` is `<repo>#<file>` for a type of this repository and the bare
 * package name for one that came from a shared package, which is exactly the
 * distinction wanted: a package is never a file this build removed.
 */
const ownerOfType = (entry: TypeEntry): string => {
  const at = entry.declaredIn.indexOf('#');
  return at < 0 ? entry.declaredIn : entry.declaredIn.slice(at + 1);
};

/**
 * Replaces the part of a graph a set of files owns.
 *
 * Everything the removed and re-read files used to own is dropped, the fragment
 * the extractor just produced is added, and the result goes back through
 * {@link GraphBuilder} so that ordering, deduplication and the dangling-edge
 * check are the same ones a full build applies. Rebuilding rather than mutating
 * is what keeps two builds of unchanged sources byte-identical.
 *
 * A node the graph cannot attribute to a file, such as a table or a third-party
 * host, is kept only while an edge still points at it: nothing else can say
 * when it stopped existing.
 */
export const spliceRepoGraph = (
  previous: RepoGraph,
  removedFiles: readonly string[],
  partial: RepoGraph,
): RepoGraph => {
  const dropped = new Set(removedFiles);
  const before = new Map(previous.nodes.map((node) => [node.id, node]));
  const survives = (file: string | undefined): boolean => file === undefined || !dropped.has(file);

  const nodes: GraphNode[] = [
    ...previous.nodes.filter((node) => survives(node.file)),
    ...partial.nodes,
  ];
  const edges: GraphEdge[] = [
    ...previous.edges.filter((edge) => survives(ownerOfEdge(edge, before))),
    ...partial.edges,
  ];
  const types: Array<[string, TypeEntry]> = [
    ...Object.entries(previous.types).filter(([, entry]) => survives(ownerOfType(entry))),
    ...Object.entries(partial.types),
  ];
  const rows: Unresolved[] = [
    ...previous.unresolved.filter((row) => survives(row.file)),
    ...partial.unresolved,
  ];

  const anchored = new Set<string>();
  for (const edge of edges) {
    anchored.add(edge.from);
    anchored.add(edge.to);
  }
  const stands = (node: GraphNode): boolean =>
    node.file !== undefined || node.type === 'repo' || anchored.has(node.id);

  const builder = new GraphBuilder({
    repo: partial.repo,
    generatedAt: partial.generatedAt,
    ...(partial.meta === undefined ? {} : { meta: partial.meta }),
  });
  for (const node of nodes) if (stands(node)) builder.addNode(node);
  for (const [id, entry] of types) builder.addType(id, entry);
  for (const row of rows) builder.addUnresolved(row);
  for (const edge of edges) builder.addEdge(edge);

  return builder.build();
};
