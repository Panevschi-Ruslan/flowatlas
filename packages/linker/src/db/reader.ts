import Database from 'better-sqlite3';
import type {
  GraphEdge,
  GraphNode,
  ServiceSummary,
  TypeEntry,
  UnresolvedLevel,
} from '@flowatlas/core';
import type { LinkReport } from '../report.js';

export interface TraverseOptions {
  from: string | readonly string[];
  direction?: 'out' | 'in';
  edgeTypes?: readonly string[];
  maxDepth?: number;
  maxNodes?: number;
}

export interface TraverseRow {
  id: string;
  depth: number;
  /** How this node was reached, `>` separated. */
  path: string;
  type: string;
  kind: string | null;
  label: string;
  service: string | null;
  file: string | null;
  line: number | null;
  /** Edge that led here, absent for the starting nodes. */
  edgeType: string | null;
  confidence: string | null;
  meta: Record<string, unknown>;
}

export interface TraverseResult {
  rows: TraverseRow[];
  /** True when the walk stopped at the limit rather than at the end. */
  truncated: boolean;
}

/** One row of the findings table, as stored. */
export interface UnresolvedRow {
  service: string | null;
  file: string | null;
  line: number | null;
  reason: string;
  /** `action` for something to fix, `info` for a limit of static reading. */
  level: UnresolvedLevel;
  /** Places this row stands for. More than one only for an informational row. */
  sites: number;
  message: string;
  hint: string | null;
}

export interface SearchOptions {
  types?: readonly string[];
  limit?: number;
}

const parse = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
};

interface NodeRow {
  id: string;
  type: string;
  kind: string | null;
  label: string;
  service: string | null;
  repo: string | null;
  file: string | null;
  line: number | null;
  meta: string;
}

interface EdgeRow {
  from_id: string;
  to_id: string;
  type: string;
  confidence: string;
  params: string | null;
  returns: string | null;
  file: string | null;
  line: number | null;
  meta: string;
}

const toNode = (row: NodeRow): GraphNode => ({
  id: row.id,
  type: row.type as GraphNode['type'],
  label: row.label,
  repo: row.repo ?? '',
  ...(row.kind === null ? {} : { kind: row.kind }),
  ...(row.file === null ? {} : { file: row.file }),
  ...(row.line === null ? {} : { line: row.line }),
  meta: parse(row.meta),
});

interface TypeRow {
  id: string;
  name: string;
  kind: string;
  declared_in: string;
  structural_hash: string;
  fields: string;
  /** Absent from a database written before the column existed. */
  members?: string;
  meta: string;
}

const toType = (row: TypeRow): TypeEntry & { id: string } => {
  // Absent rather than empty for a shape, which has no members and never had
  // the key. Only a set of values carries one.
  const members = JSON.parse(row.members ?? '[]') as string[];
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as TypeEntry['kind'],
    declaredIn: row.declared_in,
    structuralHash: row.structural_hash,
    fields: JSON.parse(row.fields) as TypeEntry['fields'],
    ...(members.length === 0 ? {} : { members }),
    meta: parse(row.meta),
  };
};

const toEdge = (row: EdgeRow): GraphEdge => ({
  from: row.from_id,
  to: row.to_id,
  type: row.type as GraphEdge['type'],
  confidence: row.confidence as GraphEdge['confidence'],
  ...(row.params === null ? {} : { params: JSON.parse(row.params) as string[] }),
  ...(row.returns === null ? {} : { returns: row.returns }),
  ...(row.file === null ? {} : { file: row.file }),
  ...(row.line === null ? {} : { line: row.line }),
  meta: parse(row.meta),
});

/** Keeps the shallowest sighting of each node; rows arrive depth-ordered. */
const once = (result: TraverseResult): TraverseResult => {
  const seen = new Set<string>();
  const rows = result.rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return { rows, truncated: result.truncated };
};

/**
 * Read access to a built graph.
 *
 * Everything a caller might ask is bounded: a walk stops at a depth and at a
 * number of nodes and says which it was, because the point of this layer is to
 * answer a question without handing back the entire graph.
 */
export class GraphDb {
  readonly #db: Database.Database;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.#db = new Database(path, { readonly: options.readonly ?? true, fileMustExist: true });
  }

  schemaVersion(): number {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
      | { value: string }
      | undefined;
    return row === undefined ? 0 : Number(row.value);
  }

  report(): LinkReport | undefined {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('link_report') as
      | { value: string }
      | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as LinkReport);
  }

  services(): ServiceSummary[] {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('services') as
      | { value: string }
      | undefined;
    return row === undefined ? [] : (JSON.parse(row.value) as ServiceSummary[]);
  }

  node(id: string): GraphNode | undefined {
    const row = this.#db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row === undefined ? undefined : toNode(row);
  }

  nodesByType(type: string, kind?: string): GraphNode[] {
    const rows =
      kind === undefined
        ? (this.#db.prepare('SELECT * FROM nodes WHERE type = ? ORDER BY id').all(type) as NodeRow[])
        : (this.#db
            .prepare('SELECT * FROM nodes WHERE type = ? AND kind = ? ORDER BY id')
            .all(type, kind) as NodeRow[]);
    return rows.map(toNode);
  }

  edgesFrom(id: string, types?: readonly string[]): GraphEdge[] {
    return this.#edges('from_id', id, types);
  }

  edgesTo(id: string, types?: readonly string[]): GraphEdge[] {
    return this.#edges('to_id', id, types);
  }

  /** Reads the same way round as `edgesTo`; kept for callers that prefer it. */
  edgesInto(id: string, types?: readonly string[]): GraphEdge[] {
    return this.edgesTo(id, types);
  }

  #edges(column: 'from_id' | 'to_id', id: string, types?: readonly string[]): GraphEdge[] {
    const filter = types === undefined || types.length === 0 ? null : JSON.stringify(types);
    const rows = this.#db
      .prepare(
        `SELECT * FROM edges WHERE ${column} = ?
           AND (? IS NULL OR type IN (SELECT value FROM json_each(?)))
         ORDER BY to_id, type`,
      )
      .all(id, filter, filter) as EdgeRow[];
    return rows.map(toEdge);
  }

  type(id: string): (TypeEntry & { id: string }) | undefined {
    const row = this.#db.prepare('SELECT * FROM types WHERE id = ?').get(id) as TypeRow | undefined;
    return row === undefined ? undefined : toType(row);
  }

  /** Every type registered under a bare name, since one name can mean several. */
  typesByName(name: string): Array<TypeEntry & { id: string }> {
    const rows = this.#db
      .prepare('SELECT * FROM types WHERE name = ? ORDER BY id')
      .all(name) as TypeRow[];
    return rows.map(toType);
  }

  /**
   * The registry itself, for a caller listing types rather than following one.
   *
   * Comparing two declarations of the same name across repositories means
   * seeing all of them, which no lookup by id or by name can give.
   */
  allTypes(options: { repo?: string; limit?: number } = {}): Array<TypeEntry & { id: string }> {
    const rows = this.#db
      .prepare(
        `SELECT * FROM types WHERE (? IS NULL OR repo = ?) ORDER BY name, id LIMIT ?`,
      )
      .all(options.repo ?? null, options.repo ?? null, options.limit ?? 100_000) as TypeRow[];
    return rows.map(toType);
  }

  /**
   * Every node, in id order.
   *
   * For the callers whose question is about the graph rather than about a node
   * in it: a whole-project count, a rendering, a diff. Anything asking about
   * one node should ask about one node.
   */
  allNodes(): GraphNode[] {
    return (this.#db.prepare('SELECT * FROM nodes ORDER BY id').all() as NodeRow[]).map(toNode);
  }

  /** Every edge, in the order the graph was written. */
  allEdges(): GraphEdge[] {
    return (
      this.#db.prepare('SELECT * FROM edges ORDER BY from_id, to_id, type').all() as EdgeRow[]
    ).map(toEdge);
  }

  /** Every finding, in the order a reader would walk them. */
  allUnresolved(): UnresolvedRow[] {
    return this.#db
      .prepare(
        'SELECT service, file, line, reason, level, sites, message, hint FROM unresolved ORDER BY service, file, line',
      )
      .all() as UnresolvedRow[];
  }

  search(text: string, options: SearchOptions = {}): GraphNode[] {
    const types = options.types === undefined || options.types.length === 0 ? null : JSON.stringify(options.types);
    const rows = this.#db
      .prepare(
        `SELECT * FROM nodes
          WHERE (label LIKE ? OR id LIKE ?)
            AND (? IS NULL OR type IN (SELECT value FROM json_each(?)))
          ORDER BY length(label), id
          LIMIT ?`,
      )
      .all(`%${text}%`, `%${text}%`, types, types, options.limit ?? 50) as NodeRow[];
    return rows.map(toNode);
  }

  /**
   * Walks the graph outward or backward from one or more nodes.
   *
   * The path each row was reached by is carried along, which is what stops a
   * cycle without a visited set and lets a caller rebuild the shape of the walk.
   */
  traverse(options: TraverseOptions): TraverseResult {
    const roots = typeof options.from === 'string' ? [options.from] : [...options.from];
    const direction = options.direction ?? 'out';
    const maxDepth = options.maxDepth ?? 6;
    const maxNodes = options.maxNodes ?? 150;
    const filter =
      options.edgeTypes === undefined || options.edgeTypes.length === 0
        ? null
        : JSON.stringify(options.edgeTypes);
    const [near, far] = direction === 'out' ? ['from_id', 'to_id'] : ['to_id', 'from_id'];

    const sql = `
      WITH RECURSIVE walk(node_id, depth, path, edge_id) AS (
        SELECT value, 0, value, NULL FROM json_each(?)
        UNION ALL
        SELECT e.${far}, w.depth + 1, w.path || '>' || e.${far}, e.id
          FROM walk w JOIN edges e ON e.${near} = w.node_id
         WHERE w.depth < ?
           AND instr(w.path, e.${far}) = 0
           AND (? IS NULL OR e.type IN (SELECT value FROM json_each(?)))
      )
      SELECT w.node_id AS id, w.depth, w.path,
             n.type, n.kind, n.label, n.service, n.file, n.line, n.meta,
             e.type AS edge_type, e.confidence
        FROM walk w
        JOIN nodes n ON n.id = w.node_id
        LEFT JOIN edges e ON e.id = w.edge_id
       ORDER BY w.depth, w.path
       LIMIT ?`;

    const rows = this.#db
      .prepare(sql)
      .all(JSON.stringify(roots), maxDepth, filter, filter, maxNodes + 1) as Array<
      NodeRow & { depth: number; path: string; edge_type: string | null; confidence: string | null }
    >;

    const truncated = rows.length > maxNodes;
    return {
      truncated,
      rows: rows.slice(0, maxNodes).map((row) => ({
        id: row.id,
        depth: row.depth,
        path: row.path,
        type: row.type,
        kind: row.kind,
        label: row.label,
        service: row.service,
        file: row.file,
        line: row.line,
        edgeType: row.edge_type,
        confidence: row.confidence,
        meta: parse(row.meta),
      })),
    };
  }

  /**
   * Everything reachable from these nodes, each named once.
   *
   * A node two paths lead to is one node, which is what a blast radius or a
   * reachability question is asking for. `traverse` keeps every path instead,
   * for a caller drawing the shape of the walk.
   */
  forwardReach(
    from: string | readonly string[],
    options: Omit<TraverseOptions, 'from' | 'direction'> = {},
  ): TraverseResult {
    return once(this.traverse({ ...options, from, direction: 'out' }));
  }

  /** Everything that reaches these nodes, each named once. */
  reverseReach(
    from: string | readonly string[],
    options: Omit<TraverseOptions, 'from' | 'direction'> = {},
  ): TraverseResult {
    return once(this.traverse({ ...options, from, direction: 'in' }));
  }

  /** Everything recorded against one node, for saying why a walk stops there. */
  unresolvedFor(id: string): UnresolvedRow[] {
    return this.#db
      .prepare('SELECT service, file, line, reason, level, sites, message, hint FROM unresolved WHERE node_id = ?')
      .all(id) as UnresolvedRow[];
  }

  /** Findings across the project, newest first is meaningless here, so by place. */
  unresolved(options: { reason?: string; service?: string; limit?: number } = {}): UnresolvedRow[] {
    return this.#db
      .prepare(
        `SELECT service, file, line, reason, level, sites, message, hint FROM unresolved
          WHERE (? IS NULL OR reason = ?) AND (? IS NULL OR service = ?)
          ORDER BY service, file, line LIMIT ?`,
      )
      .all(
        options.reason ?? null,
        options.reason ?? null,
        options.service ?? null,
        options.service ?? null,
        options.limit ?? 200,
      ) as UnresolvedRow[];
  }

  counts(): { nodes: number; edges: number; types: number; unresolved: number } {
    const one = (table: string): number =>
      (this.#db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { nodes: one('nodes'), edges: one('edges'), types: one('types'), unresolved: one('unresolved') };
  }

  close(): void {
    this.#db.close();
  }
}

export const openGraphDb = (path: string, options: { readonly?: boolean } = {}): GraphDb =>
  new GraphDb(path, options);

/** The name some callers prefer for the same thing. */
export const GraphStore = GraphDb;
