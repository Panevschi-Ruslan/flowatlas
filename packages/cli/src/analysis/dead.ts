import type { GraphNode } from '@flowatlas/core';
import { matchesRoutePattern, type GraphDb, type LinkReport } from '@flowatlas/linker';
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

/** Which way a field was travelling when it crossed the boundary. */
export type FieldDirection = 'request' | 'response' | 'payload';

export interface DeadField {
  typeId: string;
  field: string;
  /** Edges the field was seen going over, as `from -> to`. */
  sentOn: string[];
  direction: FieldDirection;
  /**
   * Whether anything at the far end removes it.
   *
   * Not a guess from the direction: the contract checker reads the receiver's
   * `ValidationPipe` and says so, and this is that finding. A field the pipe
   * strips never lands, so the sender believes it sent something that arrived
   * and it did not. Everything else — a response nobody declares, a request
   * into a receiver that whitelists nothing — is carried, ignored, and removed
   * by no one. Counting the two together is what made this list 1,445 rows.
   */
  dropped: boolean;
  reason: string;
}

/** What each kind of row says about itself. Fully decided by the two fields above. */
const FIELD_TRAVEL: Record<FieldDirection, string> = {
  request: 'sent in a request the receiver does not declare; nothing there removes it',
  response: 'sent in a response nothing on the far side declares; read by nobody',
  payload: 'published in a payload nothing that handles the channel declares',
};

const STRIPPED = 'sent in a request the receiver whitelists; the pipe removes it on arrival';

export interface DeadOptions {
  /** Only this service. */
  service?: string;
  /**
   * Routes the configuration has already called public, as `doctor.publicRoutes`
   * spells them. A route named there has its callers outside the project by
   * decision, and saying nobody calls it would be repeating the configuration
   * back as a finding.
   */
  publicRoutes?: readonly string[];
}

/**
 * Paths that answer something other than the project.
 *
 * Only the last segment is looked at, so `/api/health` is a probe and
 * `/api/health/reports/:param` is a route like any other. Both lists are
 * heuristics, which is what `dead` deals in; what they buy is that the four
 * kinds of row in this list stop sharing one sentence.
 *
 * Two of the probe words — `status` and `metrics` — are ordinary nouns in a
 * business API, where `GET /api/orders/:param/status` is a route somebody
 * wrote on purpose. They count only near the root, where nothing is being
 * addressed: a probe answers about the service itself, so it has nothing to
 * put in front of its own name. `events` is left out of the stream words
 * altogether, since a collection of events is as likely as a stream of them.
 */
const PROBE_SEGMENTS = new Set([
  'health',
  'healthz',
  'healthcheck',
  'livez',
  'liveness',
  'metrics',
  'ping',
  'readyz',
  'readiness',
  'status',
]);

/** How deep a path may be and still be read as a probe. `/api/health` is two. */
const PROBE_DEPTH = 2;

const STREAM_SEGMENTS = new Set(['stream', 'sse']);

/** `GET:/api/orders/:param/stream` → `{ method: 'GET', path: '/api/orders/:param/stream' }`. */
const splitKey = (key: string): { method: string; path: string } => {
  const [method = '', ...rest] = key.split(':');
  return { method, path: rest.join(':') };
};

const segmentsOf = (path: string): string[] => path.split('/').filter((part) => part !== '');

const lastSegment = (path: string): string =>
  (segmentsOf(path).pop() ?? '').toLowerCase();

const isProbe = (path: string): boolean => {
  const last = lastSegment(path);
  // A name nobody else uses says probe wherever it sits: nothing in a business
  // API is called `_db-status`. `payment-status` is a different matter — it is
  // a noun a real route uses — so a `-status` ending answers near the root and
  // nowhere else, exactly as a bare `status` does.
  if (/^_.*(status|health)$/.test(last)) return true;
  const named = PROBE_SEGMENTS.has(last) || last.endsWith('-status');
  return named && segmentsOf(path).length <= PROBE_DEPTH;
};

const isStream = (path: string): boolean => {
  const last = lastSegment(path);
  return STREAM_SEGMENTS.has(last) || last.endsWith('-stream');
};

/**
 * Why one route ended up in this list, which is not the same question as
 * whether it is dead.
 *
 * Four answers, and only the first of them is the one the command is for. A
 * reader who opens the list and finds `/health` at the top of it closes the
 * list, so each kind says what it is, and `rank` puts the rows that mean
 * something above the rows that never could — which is also the order `--max`
 * cuts from the bottom of.
 */
const ENTRY_CLASSES = {
  unexplained: { rank: 0, reason: 'no http_calls/hits from any repo (may be a public API)' },
  stream: {
    rank: 1,
    reason: 'looks like an event stream; a browser subscribing to one is not read yet',
  },
  probe: {
    rank: 2,
    reason: 'looks like a health or status probe; whatever runs it is outside the graph',
  },
  declared: {
    rank: 3,
    reason: 'declared public in the configuration; its callers are outside the project',
  },
} as const;

type EntryClass = (typeof ENTRY_CLASSES)[keyof typeof ENTRY_CLASSES];

const classOf = (key: string, publicRoutes: readonly string[]): EntryClass => {
  const { method, path } = splitKey(key);
  if (publicRoutes.some((pattern) => matchesRoutePattern(pattern, method, path))) {
    return ENTRY_CLASSES.declared;
  }
  if (isProbe(path)) return ENTRY_CLASSES.probe;
  if (isStream(path)) return ENTRY_CLASSES.stream;
  return ENTRY_CLASSES.unexplained;
};

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

  // The build already worked out which routes nothing reaches; recomputing it
  // here would be a second answer to the same question, free to disagree.
  const uncalled =
    report === undefined
      ? db
          .nodesByType('entry', 'http')
          .filter((entry) => db.edgesTo(entry.id, ['http_calls', 'hits']).length === 0)
          .map((entry) => entry.id)
      : report.routes.uncalled;

  const ranked: Array<{ rank: number; row: DeadEntry }> = [];
  for (const id of uncalled) {
    const node = db.node(id);
    if (node === undefined || !inService(node, options.service)) continue;
    // The build lists http routes only. The guard is here so that widening it
    // later cannot quietly start reporting a cron job as unreachable.
    if (excluded.has(node.kind ?? '')) continue;
    const found = classOf(keyOf(id), options.publicRoutes ?? []);
    ranked.push({
      rank: found.rank,
      row: {
        id,
        service: node.repo,
        kind: node.kind ?? 'http',
        key: keyOf(id),
        ...located(node),
        reason: found.reason,
      },
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
      // A handler whose channel nobody publishes to is the finding this
      // command is for, so it ranks with the routes nothing explains.
      ranked.push({
        rank: 0,
        row: {
          id: entryId,
          service: node.repo,
          kind: node.kind ?? 'event',
          key: keyOf(entryId),
          ...located(node),
          reason: `${channel} has no publisher in any repo`,
        },
      });
    }
  }

  // Rank first, then id. `--max` cuts from the bottom, so what it cuts is the
  // rows that say why they are here rather than the rows that do not.
  ranked.sort((a, b) => a.rank - b.rank || byId(a.row.id, b.row.id));
  return ranked.map((entry) => entry.row);
};

/** The services that publish to one channel. */
const producersOf = (db: GraphDb, channel: string): string[] =>
  servicesOf(
    db,
    db.edgesTo(channel, ['emits']).map((edge) => edge.from),
  );

/**
 * How many routes of each service a browser holds open as a stream.
 *
 * Read off the graph rather than guessed from a path: a route is a stream here
 * only because a subscription in a browser was joined to it, which is a fact
 * the linker established.
 */
const streamsByService = (db: GraphDb): Map<string, number> => {
  // Routes, not subscriptions: two screens holding the same stream open are one
  // route, and saying two would be counting the browsers rather than the ends
  // they reach.
  const routes = new Map<string, Set<string>>();
  for (const call of db.nodesByType('ui_api_call')) {
    if (call.kind !== 'sse') continue;
    for (const edge of db.edgesFrom(call.id, ['hits'])) {
      const route = db.node(edge.to);
      if (route === undefined) continue;
      const served = routes.get(route.repo) ?? new Set<string>();
      served.add(route.id);
      routes.set(route.repo, served);
    }
  }
  return new Map([...routes].map(([repo, served]) => [repo, served.size]));
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

  const record = (id: string, reason: (producers: readonly string[]) => string): void => {
    const producers = producersOf(db, id);
    const consumers = servicesOf(
      db,
      db.edgesFrom(id, ['consumes']).map((edge) => edge.to),
    );
    if (options.service !== undefined && ![...producers, ...consumers].includes(options.service)) return;
    const existing = rows.get(id);
    const said = reason(producers);
    rows.set(id, {
      id,
      producers,
      consumers,
      reason: existing === undefined ? said : `${existing.reason}; ${said}`,
    });
  };

  // A channel whose service also serves streams has a consumer the graph cannot
  // reach: the browser holding one open. Saying "no consumer in any repo" there
  // reads as "delete the publisher", and deleting it takes a live screen down.
  // Read once, and only when there is a channel to say it about.
  let streamed: ReadonlyMap<string, number> | undefined;
  for (const id of report.channels.noConsumers) {
    record(id, (producers) => {
      streamed ??= streamsByService(db);
      const serving = producers
        .map((service) => ({ service, streams: streamed?.get(service) ?? 0 }))
        .filter((found) => found.streams > 0);
      const [most] = serving.sort((a, b) => b.streams - a.streams || byId(a.service, b.service));
      // The finding is kept and the caveat added to it. The streams counted are
      // the service's, not this channel's — nothing links a channel to the
      // route that forwards it — so this says what else is true of the
      // publisher rather than claiming to have found the consumer.
      return most === undefined
        ? 'no consumer in any repo'
        : `no consumer in any repo; ${most.service} serves ${most.streams} event stream${most.streams === 1 ? '' : 's'}, whose consumers are not read yet`;
    });
  }
  for (const id of report.channels.noProducers) record(id, () => 'no producer in any repo');

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
/**
 * The rules the contract checker fires when the receiving side removes a field.
 *
 * `whitelist-strip` is a validation pipe that does not declare it;
 * `class-transformer` is a receiver that excludes it. The mechanism differs and
 * the outcome does not: what the sender sent is thrown away before anything
 * reads it.
 */
const REMOVED_BY_RECEIVER = new Set(['whitelist-strip', 'class-transformer']);

/**
 * As much of a contract finding as this file reads.
 *
 * Loose on purpose: the checker is imported at run time, so its types are not
 * available here. `direction` has three values — a channel payload is neither a
 * request nor a response — and `rule` is how the checker says it read the
 * receiver's validation rather than guessed at it.
 */
interface ContractFinding {
  kind: string;
  field?: string;
  direction?: string;
  rule?: string;
  edge?: { from: string; to: string };
  edgeKey?: string;
  typeId?: string;
}

const directionOf = (said: string | undefined): FieldDirection =>
  said === 'request' || said === 'payload' ? said : 'response';

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
    const direction = directionOf(finding.direction);
    // Keyed by direction as well: one field can be a request on one edge and a
    // channel payload on another, and those are two rows about two boundaries.
    const key = `${typeId}#${finding.field}#${direction}`;
    const on =
      finding.edgeKey ??
      (finding.edge === undefined ? '' : `${finding.edge.from} -> ${finding.edge.to}`);
    const dropped = finding.rule !== undefined && REMOVED_BY_RECEIVER.has(finding.rule);
    const existing = rows.get(key);
    if (existing === undefined) {
      rows.set(key, {
        typeId,
        field: finding.field,
        sentOn: on === '' ? [] : [on],
        direction,
        dropped,
        reason: dropped ? STRIPPED : FIELD_TRAVEL[direction],
      });
      continue;
    }
    if (on !== '' && !existing.sentOn.includes(on)) existing.sentOn.push(on);
    // One receiver removing it is enough to make it the finding the list is
    // for, whichever edge the checker happened to report first.
    if (dropped && !existing.dropped) {
      existing.dropped = true;
      existing.reason = STRIPPED;
    }
  }

  for (const row of rows.values()) row.sentOn.sort(byId);
  // What is removed first, as everywhere else in this command: the rows
  // something happens to above the rows nothing happens to, so a reader who
  // stops at the top has read the findings.
  return {
    fields: [...rows.values()].sort(
      (a, b) =>
        Number(b.dropped) - Number(a.dropped) ||
        byId(a.typeId, b.typeId) ||
        byId(a.field, b.field),
    ),
  };
};

/** How many DI findings each service has, for the banner `dead` prints. */
export const unresolvedInjectCount = (db: GraphDb, service?: string): number =>
  db
    .unresolved({ limit: 100_000, ...(service === undefined ? {} : { service }) })
    .filter((row) => UNRESOLVED_INJECTS.includes(row.reason)).length;
