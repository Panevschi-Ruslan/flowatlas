import { renameSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type RepoGraph,
  type TypeEntry,
  type Unresolved,
} from '@flowatlas/core';
import type { LinkReport } from '../report.js';
import { SCHEMA_SQL } from './schema.js';

/** A channel or a third party belongs to the project, not to any one service. */
const serviceOf = (node: GraphNode): string | null =>
  node.type === 'channel' || node.type === 'external_api' ? null : node.repo;

export interface WriteOptions {
  /** Version string recorded alongside the graph. */
  flowatlasVersion?: string;
}

/** The four statements every writer needs, prepared once per connection. */
const statementsOf = (db: Database.Database) => ({
  node: db.prepare(
    'INSERT INTO nodes (id, type, kind, label, service, repo, file, line, col, meta) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ),
  edge: db.prepare(
    'INSERT OR IGNORE INTO edges (from_id, to_id, type, confidence, params, returns, file, line, meta) VALUES (?,?,?,?,?,?,?,?,?)',
  ),
  type: db.prepare(
    'INSERT INTO types (id, name, kind, repo, declared_in, structural_hash, fields, members, meta) VALUES (?,?,?,?,?,?,?,?,?)',
  ),
  row: db.prepare(
    'INSERT INTO unresolved (service, file, line, reason, level, sites, message, hint, node_id) VALUES (?,?,?,?,?,?,?,?,?)',
  ),
});

type Statements = ReturnType<typeof statementsOf>;

const insertNode = (statements: Statements, item: GraphNode): void => {
  statements.node.run(
    item.id,
    item.type,
    item.kind ?? null,
    item.label,
    serviceOf(item),
    item.repo,
    item.file ?? null,
    item.line ?? null,
    null,
    JSON.stringify(item.meta ?? {}),
  );
};

const insertEdge = (statements: Statements, item: GraphEdge): void => {
  statements.edge.run(
    item.from,
    item.to,
    item.type,
    item.confidence,
    item.params === undefined ? null : JSON.stringify(item.params),
    item.returns ?? null,
    item.file ?? null,
    item.line ?? null,
    JSON.stringify(item.meta ?? {}),
  );
};

const insertType = (statements: Statements, id: string, entry: TypeEntry): void => {
  statements.type.run(
    id,
    entry.name,
    entry.kind,
    /^type:([^#]+)#/.exec(id)?.[1] ?? null,
    entry.declaredIn,
    entry.structuralHash,
    JSON.stringify(entry.fields ?? []),
    JSON.stringify(entry.members ?? []),
    JSON.stringify(entry.meta ?? {}),
  );
};

const insertRow = (statements: Statements, item: Unresolved, service?: string): void => {
  statements.row.run(
    item.service ?? service ?? null,
    item.file,
    item.line,
    item.reason,
    item.level ?? 'action',
    item.sites ?? 1,
    item.message ?? item.symbol ?? item.reason,
    item.hint ?? null,
    // The symbol is the node the finding is about, when the finding is about
    // one. Anchoring it lets a reader ask what is wrong with a node rather than
    // reading the whole list.
    item.symbol ?? null,
  );
};

/**
 * Renames over the target, waiting briefly for a reader that holds it.
 *
 * On Windows a file open for reading cannot be replaced, and the reader here is
 * the server, which reopens the database whenever its timestamp changes. Giving
 * up immediately would fail a rebuild for a race that lasts milliseconds.
 */
const renameOver = (from: string, to: string, attempts = 20): void => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        throw cause;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
};

/**
 * Writes the graph to a database file.
 *
 * Built into a temporary file and renamed into place, so a reader either sees
 * the previous build or the new one and never a half-written mixture.
 */
let built = 0;

export const writeGraphDb = (
  project: ProjectGraph,
  report: LinkReport,
  dbPath: string,
  options: WriteOptions = {},
): void => {
  // Named after the process building it. Two runs over one project each used to
  // take `<db>.building`, and the second would find the first had renamed it
  // away underneath.
  const temporary = `${dbPath}.${process.pid}.${(built += 1)}.building`;
  rmSync(temporary, { force: true });

  const db = new Database(temporary);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA_SQL);

    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    const statements = statementsOf(db);

    db.transaction(() => {
      meta.run('schema_version', String(SCHEMA_VERSION));
      meta.run('built_at', project.builtAt);
      meta.run('config_hash', report.configHash);
      meta.run('flowatlas_version', options.flowatlasVersion ?? '0.0.0');
      meta.run('services', JSON.stringify(project.services));
      meta.run('link_report', JSON.stringify(report));

      for (const item of project.nodes) insertNode(statements, item);
      for (const item of project.edges) insertEdge(statements, item);
      for (const [id, entry] of Object.entries(project.types)) insertType(statements, id, entry);
      for (const item of project.unresolved) insertRow(statements, item);
    })();
  } finally {
    db.close();
  }

  for (const suffix of ['-wal', '-shm']) rmSync(`${temporary}${suffix}`, { force: true });
  rmSync(dbPath, { force: true });
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  renameOver(temporary, dbPath);
};

/**
 * Replaces everything one repository owns, in a single transaction.
 *
 * A repository owns its own nodes, the edges that leave them, the types it
 * declares and the findings recorded against it. What crosses a boundary, a
 * channel or a third-party host, is owned by the project and left alone, which
 * is why the delete goes by `service` and not by `repo`.
 *
 * `build` does not use this: linking always runs in full and produces a whole
 * project graph, which is cheaper to write from scratch than to patch. It
 * exists for a reader that holds a database open and wants one repository
 * brought up to date under it.
 */
export const replaceService = (
  db: Database.Database,
  service: string,
  graph: RepoGraph,
): void => {
  const statements = statementsOf(db);
  db.transaction(() => {
    db.prepare('DELETE FROM edges WHERE from_id IN (SELECT id FROM nodes WHERE service = ?)').run(
      service,
    );
    db.prepare('DELETE FROM nodes WHERE service = ?').run(service);
    db.prepare('DELETE FROM types WHERE repo = ?').run(service);
    db.prepare('DELETE FROM unresolved WHERE service = ?').run(service);

    for (const item of graph.nodes) insertNode(statements, item);
    for (const item of graph.edges) insertEdge(statements, item);
    for (const [id, entry] of Object.entries(graph.types)) insertType(statements, id, entry);
    for (const item of graph.unresolved) insertRow(statements, item, service);
  })();
};
