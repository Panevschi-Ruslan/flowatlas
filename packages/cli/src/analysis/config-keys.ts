import type { GraphDb } from '@flowatlas/linker';
import { FORWARD_EDGES } from '@flowatlas/mcp';
import { byId, methodsByOwner } from './graph.js';

/**
 * Edges a flow is followed along when asking what settings it needs.
 *
 * `guarded_by` is in the list and is not in an ordinary forward walk: a guard
 * is the first thing a request meets and it is where `JWT_SECRET` is read, so
 * leaving it out answers the question wrongly rather than narrowly.
 */
export const CONFIG_EDGES = [...FORWARD_EDGES, 'guarded_by'] as const;

/** Where a key is read, in the words of the file it is read in. */
export interface ConfigRead {
  file?: string;
  line?: number;
  /** The method the read sits in. */
  symbol: string;
}

export interface ConfigKeyRow {
  key: string;
  readAt: ConfigRead[];
  /** How the value is reached: a settings service, the environment, a binding. */
  via: string;
}

export interface ConfigResultBody {
  /** Keys by the service that reads them, both sorted. */
  services: Record<string, ConfigKeyRow[]>;
  /** How many findings the build recorded against nodes on this flow. */
  unresolvedAlongFlow: number;
  /** Set when the walk stopped at its limit rather than at the end of the flow. */
  reachTruncated?: boolean;
}

const DEPTH = 12;
const REACH_NODES = 4000;

const readsOf = (db: GraphDb, keyId: string, from: ReadonlySet<string> | undefined): ConfigRead[] => {
  const reads: ConfigRead[] = [];
  for (const edge of db.edgesTo(keyId, ['reads_config'])) {
    if (from !== undefined && !from.has(edge.from)) continue;
    const site = db.node(edge.from);
    const file = edge.file ?? site?.file;
    const line = edge.line ?? site?.line;
    reads.push({
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
      symbol: site?.label ?? edge.from,
    });
  }
  return reads.sort(
    (a, b) => byId(a.symbol, b.symbol) || byId(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0),
  );
};

const group = (
  db: GraphDb,
  keyIds: readonly string[],
  reachedFrom: ReadonlySet<string> | undefined,
): Record<string, ConfigKeyRow[]> => {
  const services = new Map<string, ConfigKeyRow[]>();
  for (const id of [...keyIds].sort(byId)) {
    const node = db.node(id);
    if (node === undefined) continue;
    const rows = services.get(node.repo) ?? [];
    rows.push({
      key: String(node.meta?.['key'] ?? node.label),
      readAt: readsOf(db, id, reachedFrom),
      via: String(node.meta?.['source'] ?? 'unknown'),
    });
    services.set(node.repo, rows);
  }

  const sorted: Record<string, ConfigKeyRow[]> = {};
  for (const service of [...services.keys()].sort(byId)) {
    sorted[service] = services.get(service)!.sort((a, b) => byId(a.key, b.key));
  }
  return sorted;
};

/**
 * Every setting one flow touches, wherever in the project it is read.
 *
 * The walk crosses repositories, because "what does this flow need" is only a
 * useful question when the answer includes the service the request is passed
 * on to. A guard is reached as a class, so its methods are added to the reach
 * by name: the graph holds no edge from a class to the code inside it.
 */
export const configAlongFlow = (db: GraphDb, entryId: string): ConfigResultBody => {
  const reach = db.forwardReach(entryId, {
    edgeTypes: CONFIG_EDGES,
    maxDepth: DEPTH,
    maxNodes: REACH_NODES,
  });

  const owners = methodsByOwner(db);
  const reached = new Set<string>([entryId]);
  for (const row of reach.rows) {
    reached.add(row.id);
    for (const method of owners.get(row.id) ?? []) reached.add(method);
  }

  const keys = new Set<string>();
  let unresolvedAlongFlow = 0;
  for (const id of reached) {
    unresolvedAlongFlow += db.unresolvedFor(id).length;
    for (const edge of db.edgesFrom(id, ['reads_config'])) keys.add(edge.to);
  }

  return {
    services: group(db, [...keys], reached),
    unresolvedAlongFlow,
    ...(reach.truncated ? { reachTruncated: true } : {}),
  };
};

/**
 * Every setting the project reads, whatever flow reaches it.
 *
 * The count reported alongside is of keys built at run time, which is the
 * `--all` reading of the same promise: a key nothing could record is a hole in
 * the list and the list says how many there are.
 */
export const configEverywhere = (db: GraphDb): ConfigResultBody => {
  const keys = db.nodesByType('config_key').map((node) => node.id);
  return {
    services: group(db, keys, undefined),
    unresolvedAlongFlow: db.unresolved({ reason: 'dynamic-config-key', limit: 100_000 }).length,
  };
};
