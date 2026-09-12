/**
 * Version of the graph data model.
 *
 * Bump it whenever a node type, edge type, or required field changes. Fixture
 * snapshots carry the version they were produced with, and `pnpm invariants`
 * fails when the two drift apart.
 */
export const SCHEMA_VERSION = 3;
