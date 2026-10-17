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
  // A function the platform invokes. The rules, schedules, queues and topics
  // that invoke it are read from its deployment (P23), but code that invokes it
  // by name (P24), another account and a person at a console are not, so
  // nothing in the graph reaching it still says nothing about whether anything
  // does.
  'invoke',
] as const;

/** Findings the DI resolver records when it cannot say what a token means. */
const UNRESOLVED_INJECTS = ['di-type-unresolved', 'di-token-unknown', 'di-token-ambiguous'];

/**
 * What a route nothing calls is (P91).
 *
 * `actionable` is the row the command is for: nothing calls it and nothing
 * says why. The other three each have their callers outside the project for a
 * reason the row names - a browser holding a stream open, something outside
 * that probes or posts to it, a decision the configuration or the code wrote
 * down - and are listed apart, folded, so a reader of the top of the list is
 * reading findings. None of them is dropped: a probe nobody runs is still
 * findable with `--class infrastructure`.
 */
export const ENTRY_CLASS_NAMES = ['actionable', 'stream', 'infrastructure', 'declared'] as const;
export type EntryClassName = (typeof ENTRY_CLASS_NAMES)[number];

/** What kind of infrastructure a route is, for the line that counts them. */
export type InfrastructureRole = 'probe' | 'webhook' | 'callback' | 'discovery' | 'configured';

/**
 * How sure a row is that nothing reaches the route.
 *
 * `likely-dead` is a route a call could still reach: the call's address was
 * read in part, and what was read matches the route (P91). The call is named
 * in `nearMiss`; no edge is drawn from it, because a hole may be the caller
 * and may not, and an edge claims it is.
 */
export type DeadConfidence = 'dead' | 'likely-dead';

/** A call that did not join and could still reach the route. */
export interface NearMiss {
  call: string;
  /** The call's address as far as it was read, holes included. */
  path: string;
  file?: string;
  line?: number;
}

/** How many near misses a row names. */
const NEAR_MISSES_NAMED = 3;

export interface DeadEntry {
  id: string;
  service: string;
  kind: string;
  /** The part of the id that names the route or the pattern. */
  key: string;
  file?: string;
  line?: number;
  reason: string;
  class: EntryClassName;
  /** Which rule put the row in its class: `path /healthz`, `decorator @HealthCheck`, `no caller read`. */
  why: string;
  /** For an infrastructure row, what it is. */
  role?: InfrastructureRole;
  confidence: DeadConfidence;
  /** The calls that could reach it, for a `likely-dead` row (up to three). */
  nearMiss?: NearMiss[];
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
  /** What the configuration adds to, or takes from, the infrastructure rules (`dead.infrastructure`). */
  infrastructure?: InfrastructureRules;
  /** Only rows of this class. */
  class?: EntryClassName;
}

/** `dead.infrastructure` as the configuration writes it. */
export interface InfrastructureRules {
  readonly paths: readonly string[];
  readonly decorators: readonly string[];
  readonly names: readonly string[];
  readonly builtIn: boolean;
}

const BUILT_IN_ONLY: InfrastructureRules = { paths: [], decorators: [], names: [], builtIn: true };

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
 * A reader who opens the list and finds `/health` at the top of it closes the
 * list, so each kind says what it is, and the rows that mean something are put
 * above the rows that never could.
 */
const ENTRY_REASONS = {
  actionable: 'no http_calls/hits from any repo (may be a public API)',
  stream: 'looks like an event stream; a browser subscribing to one is not read yet',
  declared: 'declared public in the configuration; its callers are outside the project',
} as const;

/**
 * Segments a receiver of somebody else's request is named by, at any depth
 * (P91): a provider posts to `/webhooks/payments`, an identity provider
 * redirects to `/oauth/callback`.
 *
 * `notify` and `notifications` are a provider's words too - a payment
 * provider's notification endpoint - and also a collection a screen reads,
 * `GET /users/:param/notifications`. Read as a receiver only where something
 * is sent to it, never on a `GET`, which is how a list a browser asks for is
 * told from a receiver a provider posts to.
 */
const RECEIVER_SEGMENTS: ReadonlyMap<string, { role: InfrastructureRole; sentOnly?: true }> = new Map([
  ['webhook', { role: 'webhook' }],
  ['webhooks', { role: 'webhook' }],
  ['hooks', { role: 'webhook' }],
  ['notify', { role: 'webhook', sentOnly: true }],
  ['notifications', { role: 'webhook', sentOnly: true }],
  ['callback', { role: 'callback' }],
  ['callbacks', { role: 'callback' }],
]);

/** Decorators that say a handler answers a probe, wherever they are written. */
const PROBE_DECORATORS = new Set(['HealthCheck']);

/**
 * Names a handler or controller is given when it answers something outside:
 * `stripeWebhook`, `PaymentsCallback`, `HealthController`, `handleWebhookEvent`.
 * Read at the end of the name, or at its start for the two spellings a
 * receiver is written with, so `fetchWebhookSettings` - a screen's own request
 * about webhooks - is not one.
 */
const NAME_RULES: ReadonlyArray<{ test: RegExp; role: InfrastructureRole }> = [
  { test: /(?:^w|W)ebhooks?$/, role: 'webhook' },
  { test: /^handleWebhook(?:[A-Z]|$)/, role: 'webhook' },
  { test: /(?:^c|C)allbacks?$/, role: 'callback' },
  { test: /^onCallback(?:[A-Z]|$)/, role: 'callback' },
  { test: /(?:^p|P)robe$/, role: 'probe' },
  { test: /HealthController$/, role: 'probe' },
];

/** The facts about one route the classes are decided from. */
export interface RouteFacts {
  readonly method: string;
  readonly path: string;
  /** Decorators on the handler and on its controller, by name. */
  readonly decorators: readonly string[];
  /** The handler's own name: a method's, or a function's. */
  readonly handler?: string;
  readonly controller?: string;
  /** What `@flowatlas-public` says, where the handler carries one (P90). */
  readonly publicNote?: string;
}

/** Where one row belongs, and the rule that put it there. */
export interface RouteClass {
  readonly class: EntryClassName;
  readonly why: string;
  readonly reason: string;
  readonly role?: InfrastructureRole;
}

const ROLE_REASONS: Readonly<Record<InfrastructureRole, string>> = {
  probe: 'looks like a health or status probe; whatever runs it is outside the graph',
  webhook: 'looks like a webhook receiver; whatever posts to it is outside the project',
  callback: 'looks like a callback a provider redirects to; whoever sends it there is outside the project',
  discovery: 'a well-known address, asked for by clients outside the project',
  configured: 'named infrastructure under dead.infrastructure; its callers are outside the project',
};

const infrastructureRow = (role: InfrastructureRole, why: string): RouteClass => ({
  class: 'infrastructure',
  role,
  why,
  reason: ROLE_REASONS[role],
});

/** The names a handler or controller is read by, `Controller` left off a controller's. */
const namesOf = (facts: RouteFacts): string[] =>
  [facts.handler, facts.controller, facts.controller?.replace(/Controller$/, '')].filter(
    (name): name is string => name !== undefined && name !== '',
  );

/** The built-in rules, in the order a reader would give them: what the code says, then the address, then the name. */
const builtInClassOf = (facts: RouteFacts): RouteClass | undefined => {
  const decorator = facts.decorators.find((name) => PROBE_DECORATORS.has(name));
  if (decorator !== undefined) return infrastructureRow('probe', `decorator @${decorator}`);
  if (isProbe(facts.path)) return infrastructureRow('probe', `path ${facts.path}`);
  const segments = segmentsOf(facts.path).map((segment) => segment.toLowerCase());
  if (segments[0] === '.well-known') return infrastructureRow('discovery', `path ${facts.path}`);
  const sent = facts.method.toUpperCase() !== 'GET';
  for (const segment of segments) {
    const receiver = RECEIVER_SEGMENTS.get(segment);
    if (receiver === undefined || (receiver.sentOnly === true && !sent)) continue;
    return infrastructureRow(receiver.role, `path ${facts.path}`);
  }
  for (const name of namesOf(facts)) {
    const rule = NAME_RULES.find((each) => each.test.test(name));
    if (rule !== undefined) return infrastructureRow(rule.role, `name ${name}`);
  }
  return undefined;
};

/** What the configuration names as infrastructure, asked before anything built in. */
const configuredClassOf = (facts: RouteFacts, rules: InfrastructureRules): RouteClass | undefined => {
  const path = rules.paths.find((pattern) => matchesRoutePattern(pattern, facts.method, facts.path));
  if (path !== undefined) return infrastructureRow('configured', `dead.infrastructure.paths ${path}`);
  const decorator = rules.decorators.find((name) => facts.decorators.includes(name));
  if (decorator !== undefined) return infrastructureRow('configured', `dead.infrastructure.decorators @${decorator}`);
  const labels = [
    ...namesOf(facts),
    ...(facts.controller !== undefined && facts.handler !== undefined ? [`${facts.controller}.${facts.handler}`] : []),
  ];
  const name = rules.names.find((each) => labels.includes(each));
  return name === undefined ? undefined : infrastructureRow('configured', `dead.infrastructure.names ${name}`);
};

/**
 * Which class a route nothing calls belongs to, and why (P91).
 *
 * Declared first: a route the configuration or the code calls public has its
 * callers outside by decision, whatever its address looks like. Then what the
 * configuration names as infrastructure, then the built-in rules - a decorator,
 * the address, the name - then a stream, and what none of them explains is the
 * finding.
 */
export const classifyRoute = (
  facts: RouteFacts,
  options: { publicRoutes?: readonly string[]; infrastructure?: InfrastructureRules } = {},
): RouteClass => {
  const declared = (options.publicRoutes ?? []).find((pattern) => matchesRoutePattern(pattern, facts.method, facts.path));
  if (declared !== undefined) {
    return { class: 'declared', why: `doctor.publicRoutes ${declared}`, reason: ENTRY_REASONS.declared };
  }
  // A route the code itself says is public (P90). Not dead evidence by itself:
  // the marker says the route answers callers outside the project, which is
  // what `doctor.publicRoutes` says from the configuration's side.
  if (facts.publicNote !== undefined) {
    return {
      class: 'declared',
      why: facts.publicNote === '' ? '@flowatlas-public' : `@flowatlas-public ${facts.publicNote}`,
      reason: 'declared public by @flowatlas-public; its callers are outside the project',
    };
  }
  const rules = options.infrastructure ?? BUILT_IN_ONLY;
  const found = configuredClassOf(facts, rules) ?? (rules.builtIn ? builtInClassOf(facts) : undefined);
  if (found !== undefined) return found;
  if (isStream(facts.path)) return { class: 'stream', why: `path ${facts.path}`, reason: ENTRY_REASONS.stream };
  return { class: 'actionable', why: 'no caller read', reason: ENTRY_REASONS.actionable };
};

/** The name a handler node is called by: `OrdersController.list` is `list`. */
const ownName = (label: string): string => label.slice(label.lastIndexOf('.') + 1);

/** The decorators an entry records, its handler's and its controller's, by name. */
const decoratorNamesOf = (node: GraphNode): string[] => {
  const named = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .map((item) => (typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : item))
          .filter((name): name is string => typeof name === 'string')
      : [];
  return [...named(node.meta?.['decorators']), ...named(node.meta?.['controllerDecorators'])];
};

/** What a route says about itself, with its handler's label where one handles it. */
export const routeFactsOf = (node: GraphNode, handlerLabel?: string): RouteFacts => {
  const key = splitKey(keyOf(node.id));
  const method = node.meta?.['method'];
  const path = node.meta?.['path'];
  const controller = node.meta?.['controller'];
  const publicNote = node.meta?.['publicNote'];
  return {
    method: typeof method === 'string' ? method : key.method,
    path: typeof path === 'string' ? path : key.path,
    decorators: decoratorNamesOf(node),
    ...(handlerLabel === undefined ? {} : { handler: ownName(handlerLabel) }),
    ...(typeof controller === 'string' ? { controller } : {}),
    ...(typeof publicNote === 'string' ? { publicNote } : {}),
  };
};

/**
 * How each class ranks, which is the order rows are listed in and the order
 * `--max` cuts from the bottom of. A `likely-dead` row is actionable and ranks
 * after the actionable rows nothing could reach.
 */
const RANKS: Readonly<Record<EntryClassName, number>> = { actionable: 0, stream: 2, infrastructure: 3, declared: 4 };

const rankOf = (row: Pick<DeadEntry, 'class' | 'confidence'>): number =>
  RANKS[row.class] + (row.class === 'actionable' && row.confidence === 'likely-dead' ? 1 : 0);

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

  // The calls the build found could still reach each route (P91), named
  // rather than re-matched here, so the command and the report agree.
  const nearMissed = report?.routes.nearMissed ?? {};
  const nearMissesOf = (id: string): NearMiss[] =>
    (Object.hasOwn(nearMissed, id) ? (nearMissed[id] ?? []) : []).slice(0, NEAR_MISSES_NAMED).flatMap((callId) => {
      const call = db.node(callId);
      if (call === undefined) return [];
      return [{ call: callId, path: String(call.meta?.['path'] ?? '?'), ...located(call) }];
    });

  const rows: DeadEntry[] = [];
  for (const id of uncalled) {
    const node = db.node(id);
    if (node === undefined || !inService(node, options.service)) continue;
    // The build lists http routes only. The guard is here so that widening it
    // later cannot quietly start reporting a cron job as unreachable.
    if (excluded.has(node.kind ?? '')) continue;
    const handler = db.edgesFrom(id, ['handles']).map((edge) => db.node(edge.to)?.label).find((label) => label !== undefined);
    const found = classifyRoute(routeFactsOf(node, handler), options);
    const nearMiss = nearMissesOf(id);
    rows.push({
      id,
      service: node.repo,
      kind: node.kind ?? 'http',
      key: keyOf(id),
      ...located(node),
      reason:
        nearMiss.length === 0
          ? found.reason
          : `${found.reason}; a request whose address was read in part could reach it`,
      class: found.class,
      why: found.why,
      ...(found.role === undefined ? {} : { role: found.role }),
      confidence: nearMiss.length === 0 ? 'dead' : 'likely-dead',
      ...(nearMiss.length === 0 ? {} : { nearMiss }),
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
      rows.push({
        id: entryId,
        service: node.repo,
        kind: node.kind ?? 'event',
        key: keyOf(entryId),
        ...located(node),
        reason: `${channel} has no publisher in any repo`,
        class: 'actionable',
        why: 'no publisher read',
        confidence: 'dead',
      });
    }
  }

  // Rank first, then id. `--max` cuts from the bottom, so what it cuts is the
  // rows that say why they are here rather than the rows that do not.
  const wanted = options.class === undefined ? rows : rows.filter((row) => row.class === options.class);
  return wanted.sort((a, b) => rankOf(a) - rankOf(b) || byId(a.id, b.id));
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
