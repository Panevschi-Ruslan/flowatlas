import {
  FlowatlasError,
  SCHEMA_VERSION,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeRegistry,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/** One repository's reading of a type a shared package declares. */
export interface TypeVersion {
  repo: string;
  structuralHash: string;
}

export interface Merged {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  types: TypeRegistry;
  unresolved: Unresolved[];
  sharedTypes: number;
  /** Ids two repositories both claimed, which should not be possible. */
  collisions: Unresolved[];
}

/** Nodes that belong to the project rather than to any one repository. */
const isShared = (node: GraphNode): boolean =>
  node.type === 'channel' || node.type === 'external_api';

/** `type:@fx/contracts#OrderDto` → `@fx/contracts`. */
const packageOfTypeId = (id: string): string | undefined => /^type:([^#]+)#/.exec(id)?.[1];

/** A graph from another version of the model cannot be merged with this one. */
const assertCurrent = (graph: RepoGraph): void => {
  if (graph.schemaVersion === SCHEMA_VERSION) return;
  throw new FlowatlasError(
    'schema-version-mismatch',
    `graph.json of ${graph.repo} is schema v${graph.schemaVersion}, expected v${SCHEMA_VERSION}`,
    'Re-run extract for that repository.',
  );
};

/**
 * Puts the repository graphs side by side.
 *
 * Almost every id already carries its repository, so merging is mostly a
 * concatenation. The exceptions are the nodes that exist so two services can
 * meet on them: a channel and a third party are one node for the whole project,
 * which is why neither carries a repository prefix.
 */
export const mergeGraphs = (graphs: readonly RepoGraph[], config: FlowatlasConfig): Merged => {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const types: TypeRegistry = {};
  const unresolved: Unresolved[] = [];
  const shared = new Set(config.sharedPackages);
  const collisions: Unresolved[] = [];
  let sharedTypes = 0;

  for (const graph of graphs) assertCurrent(graph);

  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const existing = nodes.get(node.id);
      if (existing === undefined) {
        nodes.set(node.id, { ...node });
        continue;
      }
      // Two repositories describing one shared node; keep the first and note
      // that both reached it.
      if (isShared(node)) {
        const seen = new Set([
          ...((existing.meta?.['adapters'] as string[] | undefined) ?? []),
          ...((node.meta?.['adapters'] as string[] | undefined) ?? []),
        ]);
        existing.meta = {
          ...node.meta,
          ...existing.meta,
          ...(seen.size > 0 ? { adapters: [...seen].sort() } : {}),
        };
        continue;
      }
      // Every other id carries its repository, so two repositories reaching the
      // same one means an id is not as unique as it claims. Keep the first and
      // say where both came from rather than losing one of them.
      if (existing.repo !== node.repo) {
        collisions.push({
          service: node.repo,
          file: node.file ?? '',
          line: node.line ?? 0,
          reason: 'duplicate-node-id',
          message: `${node.id} was produced by both ${existing.repo} and ${node.repo}`,
          hint: `Kept the one from ${existing.repo} (${existing.file ?? 'unknown file'}).`,
          symbol: node.id,
        });
      }
    }

    for (const edge of graph.edges) {
      const key = edgeKey(edge);
      if (!edges.has(key)) edges.set(key, { ...edge });
    }

    for (const [id, entry] of Object.entries(graph.types)) {
      const pkg = packageOfTypeId(id);
      const isSharedType = pkg !== undefined && shared.has(pkg);
      const existing = types[id];
      if (existing === undefined) {
        types[id] = isSharedType
          ? { ...entry, meta: { ...entry.meta, sharedPackage: pkg } }
          : entry;
        if (isSharedType) sharedTypes += 1;
        continue;
      }
      // One id, two shapes, which is what a version skew between repositories
      // looks like. The first wins and both are kept, so the difference is
      // visible to whoever compares contracts rather than lost in the merge.
      if (existing.structuralHash !== entry.structuralHash) {
        const seen = (existing.meta?.['versions'] as TypeVersion[] | undefined) ?? [
          { repo: existing.declaredIn, structuralHash: existing.structuralHash },
        ];
        const versions = [...seen, { repo: graph.repo, structuralHash: entry.structuralHash }]
          .filter(
            (version, index, all) =>
              all.findIndex((other) => other.structuralHash === version.structuralHash) === index,
          )
          .sort((a, b) => cmp(a.structuralHash, b.structuralHash));
        types[id] = { ...existing, meta: { ...existing.meta, versions } };
      }
    }

    for (const row of graph.unresolved) {
      unresolved.push({ ...row, service: row.service ?? graph.repo });
    }
  }

  return { nodes, edges, types, unresolved, sharedTypes, collisions };
};
