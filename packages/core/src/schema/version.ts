/**
 * Version of the graph data model.
 *
 * Bump it whenever a node type, edge type, or required field changes. Fixture
 * snapshots carry the version they were produced with, and `pnpm invariants`
 * fails when the two drift apart.
 *
 * 6 added the `workflow` entry kind and the `function` node of kind `state`
 * that its steps are (P22).
 *
 * 7 added the `graphql` entry kind: a field a resolver answers, reached
 * through the endpoint a request joins to (P232).
 *
 * 8 added the `task` entry kind (P258) and the `screen` entry kind, a
 * component the router shows at an address (P363), bumped late (P370). A
 * reader of 7 would take a screen for a kind it does not know; a graph of 7
 * opened by this one is said to be older and rebuilt, and one newer than the
 * reader is said to need a newer flowatlas (`schemaMismatchSaid`).
 */
export const SCHEMA_VERSION = 8;

/**
 * What a reader says of a graph built for another schema version (P370): an
 * older graph is rebuilt, and a newer one needs a newer flowatlas, which
 * rebuilding with this one would only hide. Said the same by every reader
 * that opens a graph.
 */
export const schemaMismatchSaid = (found: unknown, expected: number = SCHEMA_VERSION): { message: string; hint: string } => {
  if (typeof found === 'number' && found > expected) {
    return {
      message: `the graph was built by a newer flowatlas (schema ${found}); this one reads schema ${expected}`,
      hint: 'Update flowatlas (npm install -g @flowatlas/cli), or rebuild the graph with this one (flowatlas build).',
    };
  }
  if (typeof found === 'number') {
    return {
      message: `the graph was built by an older flowatlas (schema ${found}); this one reads schema ${expected}`,
      hint: 'Rebuild it: flowatlas build (or flowatlas extract for one repository).',
    };
  }
  return {
    message: `the graph says no schema version this flowatlas knows (${String(found)}); it reads schema ${expected}`,
    hint: 'Rebuild it: flowatlas build (or flowatlas extract for one repository).',
  };
};
