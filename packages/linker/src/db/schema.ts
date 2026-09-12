/**
 * The shape of a graph database, as one string.
 *
 * It lived in a `schema.sql` the writer read from beside itself, which stopped
 * being true the moment the command was compiled into a single file: there was
 * no "beside itself" any more. Generating this from the `.sql` would only move
 * the problem to whether the generated copy is current, which is the bug this
 * project has spent a day removing in three other places. So the SQL lives
 * here, in the one place that is always shipped with the code that runs it.
 */
export const SCHEMA_SQL = `-- Projection of the project graph, rebuilt from scratch on every build.
-- The JSON graph stays the canonical artefact; this exists so that questions
-- can be answered without loading the whole thing into memory.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE nodes (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL,
  kind    TEXT,
  label   TEXT NOT NULL,
  service TEXT,                     -- NULL for what belongs to the whole project
  repo    TEXT,
  file    TEXT,
  line    INTEGER,
  col     INTEGER,
  meta    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE edges (
  id         INTEGER PRIMARY KEY,
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  type       TEXT NOT NULL,
  confidence TEXT NOT NULL,
  params     TEXT,
  returns    TEXT,
  file       TEXT,
  line       INTEGER,
  meta       TEXT NOT NULL DEFAULT '{}',
  UNIQUE (from_id, to_id, type)
);

CREATE TABLE types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  repo            TEXT,
  declared_in     TEXT,
  structural_hash TEXT NOT NULL,
  fields          TEXT NOT NULL,
  -- The values an enum or a union allows. Without them a set of values read
  -- back out of here is an empty set, and two enums that have drifted apart
  -- compare as though they agreed.
  members         TEXT NOT NULL DEFAULT '[]',
  meta            TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE unresolved (
  id      INTEGER PRIMARY KEY,
  service TEXT,
  file    TEXT,
  line    INTEGER,
  reason  TEXT NOT NULL,
  level   TEXT NOT NULL DEFAULT 'action',
  sites   INTEGER NOT NULL DEFAULT 1,
  message TEXT NOT NULL,
  hint    TEXT,
  node_id TEXT
);

CREATE INDEX idx_edges_from      ON edges(from_id);
CREATE INDEX idx_edges_to        ON edges(to_id);
CREATE INDEX idx_edges_type      ON edges(type);
CREATE INDEX idx_edges_from_type ON edges(from_id, type);
CREATE INDEX idx_edges_to_type   ON edges(to_id, type);
CREATE INDEX idx_nodes_type      ON nodes(type);
CREATE INDEX idx_nodes_type_kind ON nodes(type, kind);
CREATE INDEX idx_nodes_label     ON nodes(label);
CREATE INDEX idx_nodes_service   ON nodes(service);
CREATE INDEX idx_types_hash      ON types(structural_hash);
CREATE INDEX idx_unresolved_reason ON unresolved(reason);
`;
