import type { GraphNode } from '@flowatlas/core';
import type { GraphDb, LinkReport } from '@flowatlas/linker';
import { byId, methodsByOwner } from './graph.js';

/**
 * Entry kinds something outside the graph pulls.
 *
 * A cron job fires on a clock and a bot command fires when a person types it.
 * Neither is reachable from inside the graph and neither is ever dead, so they
 * are excluded before anything else is asked about them.
 */
export const EXTERNALLY_TRIGGERED = [
  'cron',
  'bot_command',
  'bot_callback',
  'bot_event',
  'scene_step',
] as const;

/** Findings the DI resolver records when it cannot say what a token means. */
const UNRESOLVED_INJECTS = ['di-type-unresolved', 'di-token-unknown', 'di-token-ambiguous'];

export interface DeadEntry {
  id: string;
  service: string;
  kind: string;
  /** The part of the id that names the route or the pattern. */
  key: string;
  file?: string;
  line?: number;
  reason: string;
}

export interface DeadChannel {
  id: string;
  producers: string[];
  consumers: string[];
  reason: string;
}

export interface DeadProvider {
  id: string;
  service: string;
  file?: string;
  line?: number;
  reason: string;
}

export interface DeadField {
  typeId: string;
  field: string;
  /** Edges the field was seen going over, as `from -> to`. */
  sentOn: string[];
  reason: string;
}

export interface DeadOptions {
  /** Only this service. */
  service?: string;
}

const located = (node: GraphNode): { file?: string; line?: number } => ({
  ...(node.file === undefined ? {} : { file: node.file }),
  ...(node.line === undefined ? {} : { line: node.line }),
});

/** `entry:orders:http:POST:/orders` → `POST:/orders`. */
const keyOf = (id: string): string => id.split(':').slice(3).join(':');

const inService = (node: { repo: string }, service?: string): boolean =>
  service === undefined || node.repo === service;

/** Services the far end of these edges belongs to, ascending and deduplicated. */
const servicesOf = (db: GraphDb, ids: readonly string[]): string[] =>
  [...new Set(ids.map((id) => db.node(id)?.repo).filter((repo): repo is string => repo !== undefined))].sort(
    byId,
  );

/**
 * Routes nothing in the project calls, and handlers whose channel is silent.
 *
 * A public API with no internal callers is not dead, which is why every row
 * carries a reason rather than a verdict. Externally triggered kinds are left
 * out entirely: reporting them would drown the rows that mean something.
 */
export const deadEntries = (
  db: GraphDb,
  report: LinkReport | undefined,
  options: DeadOptions = {},
): DeadEntry[] => {
  const excluded = new Set<string>(EXTERNALLY_TRIGGERED);
  const rows: DeadEntry[] = [];

  // The build already worked out which routes nothing reaches; recomputing it
  // here would be a second answer to the same question, free to disagree.
  const uncalled =
    report === undefined
      ? db
          .nodesByType('entry', 'http')
          .filter((entry) => db.edgesTo(entry.id, ['http_calls', 'hits']).length === 0)
          .map((entry) => entry.id)
      : report.routes.uncalled;

  for (const id of uncalled) {
    const node = db.node(id);
    if (node === undefined || !inService(node, options.service)) continue;
    // The build lists http routes only. The guard is here so that widening it
    // later cannot quietly start reporting a cron job as unreachable.
    if (excluded.has(node.kind ?? '')) continue;
    rows.push({
      id,
      service: node.repo,
      kind: node.kind ?? 'http',
      key: keyOf(id),
      ...located(node),
      reason: 'no http_calls/hits from any repo (may be a public API)',
    });
  }

  for (const channel of report?.channels.noProducers ?? []) {
    for (const edge of db.edgesFrom(channel, ['consumes'])) {
      const consumer = db.node(edge.to);
      const entryId = consumer?.meta?.['entryId'];
      if (typeof entryId !== 'string') continue;
      const node = db.node(entryId);
      if (node === undefined || excluded.has(node.kind ?? '')) continue;
      if (!inService(node, options.service)) continue;
      rows.push({
        id: entryId,
        service: node.repo,
        kind: node.kind ?? 'event',
        key: keyOf(entryId),
        ...located(node),
        reason: `${channel} has no publisher in any repo`,
      });
    }
  }

  return rows.sort((a, b) => byId(a.id, b.id));
};

/**
 * Channels missing an end, with the services at the end they have.
 *
 * The same predicate the build reports on, read back rather than recomputed.
 * A channel with publishers and no handlers may simply have its handler in a
 * repository the configuration does not name yet, so the row says which
 * services are on the side that exists.
 */
export const deadChannels = (
  db: GraphDb,
  report: LinkReport | undefined,
  options: DeadOptions = {},
): DeadChannel[] => {
  if (report === undefined) return [];
  const rows = new Map<string, DeadChannel>();

  const record = (id: string, reason: string): void => {
    const producers = servicesOf(
      db,
      db.edgesTo(id, ['emits']).map((edge) => edge.from),
    );
    const consumers = servicesOf(
      db,
      db.edgesFrom(id, ['consumes']).map((edge) => edge.to),
    );
    if (options.service !== undefined && ![...producers, ...consumers].includes(options.service)) return;
    const existing = rows.get(id);
    rows.set(id, {
      id,
      producers,
      consumers,
      reason: existing === undefined ? reason : `${existing.reason}; ${reason}`,
    });
  };

  for (const id of report.channels.noConsumers) record(id, 'no consumer in any repo');
  for (const id of report.channels.noProducers) record(id, 'no producer in any repo');

  return [...rows.values()].sort((a, b) => byId(a.id, b.id));
};

/**
 * Injectable classes nothing injects and nothing hands work to.
 *
 * Three exclusions, each because the class is reached from somewhere the
 * `injects` edge cannot see: a controller is reached by its routes, a class
 * from a library is another package's business, and an exported provider is
 * consumed by whichever module imports it, possibly outside the graph.
 */
export const deadProviders = (db: GraphDb, options: DeadOptions = {}): DeadProvider[] => {
  const owners = methodsByOwner(db);
  const exported = new Map<string, Set<string>>();
  const registered = new Map<string, Set<string>>();
  const collect = (into: Map<string, Set<string>>, repo: string, names: unknown): void => {
    if (!Array.isArray(names)) return;
    const forRepo = into.get(repo) ?? new Set<string>();
    for (const name of names) if (typeof name === 'string') forRepo.add(name);
    into.set(repo, forRepo);
  };
  for (const module of db.nodesByType('module')) {
    collect(exported, module.repo, module.meta?.['exports']);
    collect(registered, module.repo, module.meta?.['providers']);
  }

  const unresolvedInjects = new Map<string, number>();
  for (const row of db.unresolved({ limit: 100_000 })) {
    if (!UNRESOLVED_INJECTS.includes(row.reason) || row.service === null) continue;
    unresolvedInjects.set(row.service, (unresolvedInjects.get(row.service) ?? 0) + 1);
  }

  const rows: DeadProvider[] = [];
  for (const provider of db.nodesByType('provider')) {
    if (!inService(provider, options.service)) continue;
    if (provider.kind === 'controller' || provider.kind === 'external') continue;
    if (exported.get(provider.repo)?.has(provider.label) === true) continue;
    if (db.edgesTo(provider.id, ['injects']).length > 0) continue;
    const methods = owners.get(provider.id) ?? [];
    if (methods.some((method) => db.edgesTo(method, ['handles', 'calls']).length > 0)) continue;

    const unresolved = unresolvedInjects.get(provider.repo) ?? 0;
    // A class no module even registers is not built by the container at all, so
    // whatever wires it does so somewhere this graph does not reach: a
    // bootstrap call, a hand-written `new`. Worth saying, because it is the
    // difference between "delete this" and "look in main.ts".
    const wiredElsewhere = registered.get(provider.repo)?.has(provider.label) !== true;
    rows.push({
      id: provider.id,
      service: provider.repo,
      ...located(provider),
      reason:
        'nothing injects it and nothing reaches its methods' +
        (wiredElsewhere ? '; no module registers it either — check the bootstrap file' : '') +
        (unresolved === 0 ? '' : `; ${provider.repo} has ${unresolved} unresolved injects — verify`),
    });
  }

  return rows.sort((a, b) => byId(a.id, b.id));
};

export interface FieldsResult {
  fields: DeadField[];
  /** Set when the contracts package could not answer. */
  warning?: { reason: string; hint: string };
}

/**
 * As much of a contract finding as this section reads.
 *
 * Deliberately loose: the package that produces these is not a dependency, so
 * what arrives is whatever version happens to be installed.
 */
interface ContractFinding {
  kind: string;
  field?: string;
  edge?: { from: string; to: string };
  edgeKey?: string;
  typeId?: string;
}

interface ContractsModule {
  checkContracts?: (db: GraphDb) => { findings: ContractFinding[] };
}

/**
 * Fields one service sends and the receiver does not declare.
 *
 * The question this section really wants — which declared fields nobody reads —
 * needs property access analysis inside every consumer and is not v1. What the
 * contract checker already knows is the other half of the same drift: a field
 * that goes over the wire and lands nowhere.
 *
 * The checker lives in a package this one does not depend on, so it is asked
 * for at run time and its absence is an answer rather than a crash.
 */
export const deadFields = async (db: GraphDb, options: DeadOptions = {}): Promise<FieldsResult> => {
  const unavailable: FieldsResult = {
    fields: [],
    warning: { reason: 'contracts-unavailable', hint: 'run after P10 / pnpm -r build' },
  };

  let findings: ContractFinding[];
  try {
    // The specifier is held in a variable so the type-checker does not try to
    // resolve a package that is not a dependency of this one.
    const specifier = '@flowatlas/contracts';
    const contracts = (await import(specifier)) as ContractsModule;
    if (typeof contracts.checkContracts !== 'function') return unavailable;
    findings = contracts.checkContracts(db).findings;
  } catch {
    return unavailable;
  }

  const rows = new Map<string, DeadField>();
  for (const finding of findings) {
    if (finding.kind !== 'extra_field' || finding.field === undefined) continue;
    const sender = finding.edge === undefined ? undefined : db.node(finding.edge.from);
    if (options.service !== undefined && sender?.repo !== options.service) continue;

    const typeId = finding.typeId ?? '';
    const key = `${typeId}#${finding.field}`;
    const on =
      finding.edgeKey ??
      (finding.edge === undefined ? '' : `${finding.edge.from} -> ${finding.edge.to}`);
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        typeId,
        field: finding.field,
        sentOn: on === '' ? [] : [on],
        reason: 'sent but not declared by any receiver',
      });
    } else if (on !== '' && !existing.sentOn.includes(on)) {
      existing.sentOn.push(on);
    }
  }

  for (const row of rows.values()) row.sentOn.sort(byId);
  return {
    fields: [...rows.values()].sort((a, b) => byId(a.typeId, b.typeId) || byId(a.field, b.field)),
  };
};

/** How many DI findings each service has, for the banner `dead` prints. */
export const unresolvedInjectCount = (db: GraphDb, service?: string): number =>
  db
    .unresolved({ limit: 100_000, ...(service === undefined ? {} : { service }) })
    .filter((row) => UNRESOLVED_INJECTS.includes(row.reason)).length;
