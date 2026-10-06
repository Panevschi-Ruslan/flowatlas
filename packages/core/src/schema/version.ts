/**
 * Version of the graph data model.
 *
 * Bump it whenever a node type, edge type, or required field changes. Fixture
 * snapshots carry the version they were produced with, and `pnpm invariants`
 * fails when the two drift apart.
 *
 * 6 added the `workflow` entry kind and the `function` node of kind `state`
 * that its steps are (P22).
 */
export const SCHEMA_VERSION = 6;
