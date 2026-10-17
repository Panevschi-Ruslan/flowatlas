import type { GraphDb } from '../db/reader.js';

export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Which class each method belongs to.
 *
 * A method id is its class id plus `.name`, and nothing else in the grammar
 * ends that way, so the owner is recoverable without another table. Needed
 * because the graph has no edge from a class to its own methods: a guard is
 * reached as a class and reads its settings inside a method. Moved here from
 * the CLI (P95) so the `dead` analysis and the MCP server group methods the
 * same way.
 */
export const methodsByOwner = (db: GraphDb): Map<string, string[]> => {
  const owners = new Map<string, string[]>();
  for (const method of db.nodesByType('method')) {
    const owner = ownerOf(method.id);
    if (owner === undefined) continue;
    const list = owners.get(owner);
    if (list === undefined) owners.set(owner, [method.id]);
    else list.push(method.id);
  }
  for (const list of owners.values()) list.sort(byId);
  return owners;
};

/** The class a method id belongs to: its id up to the last `.`, or undefined. */
export const ownerOf = (methodId: string): string | undefined => {
  const cut = methodId.lastIndexOf('.');
  return cut <= 0 ? undefined : methodId.slice(0, cut);
};

/** One class's methods, by id prefix, ascending. */
export const methodsOf = (db: GraphDb, classId: string): string[] =>
  db
    .nodesByType('method')
    .filter((method) => ownerOf(method.id) === classId)
    .map((method) => method.id)
    .sort(byId);
