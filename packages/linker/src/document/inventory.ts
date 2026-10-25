/**
 * Every route of a project in one table, read from the code (P118): the code
 * inventory. One row per route and per procedure, with what a reviewer asks
 * of each first - who may call it (guarded, public), who does (callers), and
 * what it touches (tables written, channels published) and fails with.
 *
 * What a route touches is walked forward inside its own service: a request to
 * another service is that service's row, not this one's.
 */
import type { GraphLookup } from '@flowatlas/contracts';
import { accessOf, failuresOf, groupFailures, type GraphNode } from '@flowatlas/core';
import { cmp, publicOf, routeCallers, callersBy, serviceNodes, applicationOf, type SpecOptions } from './written.js';

/** One row of the inventory. */
export interface InventoryRow {
  service: string;
  application?: string;
  /** `http` for a route, `procedure` for a procedure. */
  kind: 'http' | 'procedure';
  /** The verb; `ALL` for a route that answers every verb; empty for a procedure. */
  verb: string;
  /** The path as matched, or the procedure's name. */
  path: string;
  id: string;
  guarded: boolean;
  /** Why it is open on purpose, when something says so. */
  public?: string;
  /** Joined callers by service. */
  callers: Record<string, number>;
  tables: string[];
  channels: string[];
  /** Statuses it fails with, `500?` where every site of it is assumed, `?` for one not read. */
  fails: string[];
  file?: string;
  line?: number;
}

/** How far forward a route's work is followed for what it writes and publishes. */
const MOST_WALKED = 2000;

/** The edges a route's own work runs along, inside its service. */
const WORK = ['handles', 'calls', 'caches', 'triggers'];

const touched = (lookup: GraphLookup, entry: GraphNode): { tables: string[]; channels: string[] } => {
  const tables = new Set<string>();
  const channels = new Set<string>();
  const seen = new Set<string>([entry.id]);
  let frontier = [entry.id];
  while (frontier.length > 0 && seen.size < MOST_WALKED) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of lookup.edgesFrom(id, WORK)) {
        if (seen.has(edge.to)) continue;
        const node = lookup.node(edge.to);
        if (node === undefined || node.repo !== entry.repo) continue;
        seen.add(edge.to);
        if (node.type === 'db_query' && node.meta?.['op'] !== 'read') {
          const named = node.meta?.['tables'];
          const list = Array.isArray(named) ? named.filter((name): name is string => typeof name === 'string') : [];
          for (const table of list.length === 0 ? lookup.edgesFrom(node.id, ['queries']).map((query) => lookup.node(query.to)?.label ?? query.to) : list) tables.add(table);
        }
        if (node.type === 'producer') {
          for (const emit of lookup.edgesFrom(node.id, ['emits'])) channels.add(emit.to.replace(/^channel:/, ''));
        }
        next.push(edge.to);
      }
    }
    frontier = next;
  }
  return { tables: [...tables].sort(cmp), channels: [...channels].sort(cmp) };
};

const failsSaid = (entry: GraphNode): string[] => {
  const said = new Set<string>();
  for (const group of groupFailures(failuresOf(entry))) {
    const statuses = group.status !== undefined ? [group.status] : (group.chosenFrom ?? []).flatMap((choice) => (choice.status === undefined ? [] : [choice.status]));
    if (statuses.length === 0) said.add('?');
    for (const status of statuses) said.add(`${status}${group.assumed === true ? '?' : ''}`);
  }
  return [...said].sort((a, b) => (Number.parseInt(a, 10) || 1000) - (Number.parseInt(b, 10) || 1000) || cmp(a, b));
};

/** The inventory of the services named, routes then procedures, by service, path and verb. */
export const routeInventory = (lookup: GraphLookup, services: readonly string[], options: SpecOptions = {}): InventoryRow[] => {
  const rows: InventoryRow[] = [];
  for (const service of services) {
    for (const entry of serviceNodes(lookup, 'entry', service)) {
      if (entry.kind !== 'http' && entry.kind !== 'rpc') continue;
      const procedure = entry.kind === 'rpc';
      const path = typeof entry.meta?.['path'] === 'string' ? (entry.meta['path'] as string) : procedure ? entry.label : '';
      const verb = procedure ? '' : typeof entry.meta?.['method'] === 'string' ? (entry.meta['method'] as string).toUpperCase() : '';
      const application = applicationOf(entry.id);
      const opened = publicOf(entry, options);
      const guarded = (accessOf(entry)?.guards.length ?? 0) > 0 || lookup.edgesFrom(entry.id, ['guarded_by']).length > 0;
      rows.push({
        service,
        ...(application === undefined ? {} : { application }),
        kind: procedure ? 'procedure' : 'http',
        verb,
        path,
        id: entry.id,
        guarded,
        ...(opened === undefined ? {} : { public: opened }),
        callers: callersBy(routeCallers(lookup, entry.id)),
        ...touched(lookup, entry),
        fails: failsSaid(entry),
        ...(entry.file === undefined ? {} : { file: entry.file }),
        ...(entry.line === undefined ? {} : { line: entry.line }),
      });
    }
  }
  return rows.sort(
    (a, b) => cmp(a.service, b.service) || cmp(a.kind, b.kind) || cmp(a.application ?? '', b.application ?? '') || cmp(a.path, b.path) || cmp(a.verb, b.verb) || cmp(a.id, b.id),
  );
};
