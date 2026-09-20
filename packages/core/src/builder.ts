import { DanglingEdgeError, DuplicateTypeError } from './errors.js';
import type { GraphEdge } from './model/edges.js';
import { strongerConfidence } from './model/edges.js';
import type { RepoGraph, Unresolved } from './model/graph.js';
import type { GraphNode } from './model/nodes.js';
import type { TypeEntry, TypeRegistry } from './model/types.js';
import { SCHEMA_VERSION } from './schema/version.js';

export interface GraphBuilderOptions {
  /** Owning repository, equal to `services[].name`. */
  repo: string;
  /** Fixed timestamp, for reproducible output. Defaults to now at `build()`. */
  generatedAt?: string;
  meta?: Record<string, unknown>;
}

export interface GraphCounts {
  nodes: number;
  edges: number;
  types: number;
  unresolved: number;
}

/** Cannot occur inside an id, so composite keys stay unambiguous. */
const SEP = '\u0000';

/** Byte-wise, locale-independent, so snapshots are stable everywhere. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const edgeKey = (edge: GraphEdge): string => `${edge.from}${SEP}${edge.type}${SEP}${edge.to}`;

const unresolvedKey = (row: Unresolved): string =>
  `${row.file}${SEP}${row.line}${SEP}${row.reason}${SEP}${row.symbol ?? ''}`;

/**
 * Folds every row below `action` to one per reason, counting the rest.
 *
 * An actionable row is a place, and a reader needs every one of them. A row
 * below it is a statement about the repository — receivers are typed as unions,
 * templates bind expressions that are not calls — and repeating it once per
 * site buries everything worth acting on. The row kept is the first by file and
 * line, so it still points at somewhere real, and `sites` says how many there
 * were.
 */
const foldBelowAction = (rows: readonly Unresolved[]): Unresolved[] => {
  const out: Unresolved[] = [];
  const folded = new Map<string, Unresolved>();
  for (const row of rows) {
    if (row.level === undefined || row.level === 'action') {
      out.push(row);
      continue;
    }
    // Keyed by level as well as reason. Two levels mean two different things —
    // an edge that could not be read, and no edge at all — so a reason that
    // ever raised both would otherwise fold them into one row carrying one
    // level and both counts, and every figure downstream would believe it.
    const key = `${row.reason}\u0000${row.level}`;
    const first = folded.get(key);
    if (first === undefined) {
      const stored: Unresolved = { ...row };
      folded.set(key, stored);
      out.push(stored);
      continue;
    }
    first.sites = (first.sites ?? 1) + 1;
  }
  return out;
};

/**
 * Collects the graph of one repository.
 *
 * Everything that must hold for every graph, regardless of which adapter
 * produced it, lives here: identity-based deduplication, the rule for merging
 * two contributions of the same edge, and a deterministic order in `build()` so
 * that two runs over unchanged sources produce byte-identical output.
 */
export class GraphBuilder {
  readonly repo: string;

  readonly #nodes = new Map<string, GraphNode>();
  readonly #edges = new Map<string, GraphEdge>();
  readonly #types = new Map<string, TypeEntry>();
  readonly #unresolved = new Map<string, Unresolved>();
  readonly #generatedAt: string | undefined;
  readonly #meta: Record<string, unknown> | undefined;

  constructor(options: GraphBuilderOptions) {
    this.repo = options.repo;
    this.#generatedAt = options.generatedAt;
    this.#meta = options.meta;
  }

  /**
   * Adds a node, or merges into the one already stored under that id.
   *
   * First writer wins on every scalar field; `meta` is shallow-merged with the
   * existing keys kept. Returns the stored node, which is the merged one.
   */
  addNode(node: GraphNode): GraphNode {
    const existing = this.#nodes.get(node.id);
    if (existing === undefined) {
      const stored: GraphNode = { ...node };
      this.#nodes.set(node.id, stored);
      return stored;
    }
    if (node.meta !== undefined) existing.meta = { ...node.meta, ...existing.meta };
    return existing;
  }

  /**
   * Adds an edge, or merges into the one already stored for the same
   * `(from, type, to)`.
   *
   * The stronger confidence wins, so a marker or a static resolution upgrades an
   * earlier guess. Fields the first contribution left empty are filled in by
   * later ones; fields it set are never overwritten.
   */
  addEdge(edge: GraphEdge): GraphEdge {
    const key = edgeKey(edge);
    const existing = this.#edges.get(key);
    if (existing === undefined) {
      const stored: GraphEdge = { ...edge };
      if (edge.params !== undefined) stored.params = [...edge.params];
      this.#edges.set(key, stored);
      return stored;
    }
    existing.confidence = strongerConfidence(existing.confidence, edge.confidence);
    if (existing.params === undefined && edge.params !== undefined) {
      existing.params = [...edge.params];
    }
    if (existing.returns === undefined && edge.returns !== undefined) {
      existing.returns = edge.returns;
    }
    if (existing.file === undefined && edge.file !== undefined) existing.file = edge.file;
    if (existing.line === undefined && edge.line !== undefined) existing.line = edge.line;
    if (edge.meta !== undefined) existing.meta = { ...edge.meta, ...existing.meta };
    return existing;
  }

  /**
   * Registers a type under its registry id.
   *
   * Registering the same id twice with a different structure is a bug, not a
   * merge: one id must mean one declaration.
   */
  addType(id: string, entry: TypeEntry): TypeEntry {
    const existing = this.#types.get(id);
    if (existing === undefined) {
      const stored: TypeEntry = { ...entry };
      this.#types.set(id, stored);
      return stored;
    }
    if (existing.structuralHash !== entry.structuralHash) {
      throw new DuplicateTypeError(id, existing.structuralHash, entry.structuralHash);
    }
    if (entry.meta !== undefined) existing.meta = { ...entry.meta, ...existing.meta };
    return existing;
  }

  /** Records something that could not be resolved. Deduplicated per site. */
  addUnresolved(row: Unresolved): Unresolved {
    const key = unresolvedKey(row);
    const existing = this.#unresolved.get(key);
    if (existing === undefined) {
      const stored: Unresolved = { ...row };
      this.#unresolved.set(key, stored);
      return stored;
    }
    if (row.meta !== undefined) existing.meta = { ...row.meta, ...existing.meta };
    return existing;
  }

  has(id: string): boolean {
    return this.#nodes.has(id);
  }

  getNode(id: string): GraphNode | undefined {
    return this.#nodes.get(id);
  }

  /** Every edge collected so far, for a pass that annotates them. */
  get edges(): readonly GraphEdge[] {
    return [...this.#edges.values()];
  }

  /**
   * The unresolved rows as anything downstream should read them: sorted, and
   * with the informational ones folded. Every caller goes through this, so a
   * count and a list can never disagree about what is in the graph.
   */
  #rows(): Unresolved[] {
    return foldBelowAction(
      [...this.#unresolved.values()].sort(
        (a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.reason, b.reason),
      ),
    );
  }

  /** Everything recorded as unresolved so far, for reporting a count. */
  get unresolved(): readonly Unresolved[] {
    return this.#rows();
  }

  get counts(): GraphCounts {
    return {
      nodes: this.#nodes.size,
      edges: this.#edges.size,
      types: this.#types.size,
      unresolved: this.#rows().length,
    };
  }

  /**
   * Freezes the collected state into a graph.
   *
   * Throws {@link DanglingEdgeError} if an edge points at a node that was never
   * added: an unreachable target belongs in `unresolved`, not in a half edge.
   */
  build(): RepoGraph {
    const edges = [...this.#edges.values()];
    const dangling = edges.filter(
      (edge) => !this.#nodes.has(edge.from) || !this.#nodes.has(edge.to),
    );
    if (dangling.length > 0) throw new DanglingEdgeError(dangling);

    const types: TypeRegistry = Object.fromEntries(
      [...this.#types.entries()].sort((a, b) => cmp(a[0], b[0])),
    );

    const graph: RepoGraph = {
      schemaVersion: SCHEMA_VERSION,
      repo: this.repo,
      generatedAt: this.#generatedAt ?? new Date().toISOString(),
      nodes: [...this.#nodes.values()].sort((a, b) => cmp(a.id, b.id)),
      edges: edges.sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.type, b.type)),
      types,
      unresolved: this.#rows(),
    };
    if (this.#meta !== undefined) graph.meta = this.#meta;
    return graph;
  }
}
