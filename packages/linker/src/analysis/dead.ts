import type { GraphNode } from '@flowatlas/core';
import type { GraphDb } from '../db/reader.js';
import type { LinkReport } from '../report.js';
import { matchesRoutePattern } from '../route-audit.js';
import { oneSegmentOff } from '../route-match.js';
import { byId, methodsByOwner, ownerOf } from './graph.js';
import { trafficOverlay, type NeverSeenConfidence, type ObservedInput, type TrafficOverlay } from './never-seen.js';

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
 * in `evidence.couldHit`; no edge is drawn from it, because a hole may be the
 * caller and may not, and an edge claims it is.
 */
export type DeadConfidence = 'dead' | 'likely-dead';

/**
 * What `dead` claims about one node (P95), the claim an assistant acts on.
 *
 * `dead`: nothing in the graph reaches it and nothing that could is unread.
 * `likely-dead`: nothing reaches it, and something read in part could (the
 * evidence names it). `unknown`: the graph's silence says nothing - it is
 * triggered from outside the project, or a call one segment off names it.
 * `alive`: something reaches it, and the evidence names one.
 */
export const DEAD_VERDICTS = ['dead', 'likely-dead', 'unknown', 'alive'] as const;
export type DeadVerdict = (typeof DEAD_VERDICTS)[number];

/** A call that did not join and could still reach the route. */
export interface NearMiss {
  call: string;
  /** The call's address as far as it was read, holes included. */
  path: string;
  file?: string;
  line?: number;
}

/** A call that names no route, one segment away from this one: renamed, or a typo. */
export interface OneOff {
  call: string;
  /** The verb and the address the call asks for. */
  asks: string;
  /** How the two differ, in words: `cancel for archive`. */
  differs: string;
  file?: string;
  line?: number;
}

/**
 * What could make a verdict wrong, or what makes it right (D2).
 *
 * `couldHit`: calls read in part whose read prefix the route's path starts
 * with (P91's near misses, read off the link report, never matched again).
 * `oneOff`: calls that found no route and differ from this one by a segment.
 * `outside`: why the graph cannot see its callers - the entry kind (`cron`),
 * the infrastructure role (`probe`), `stream`, `declared`, `exported`,
 * `library`. `callers` and `caller`: what reaches an `alive` node, counted and
 * the first by id. `missing`: the end a channel lacks. `unresolvedInjects`:
 * the injects of the service that did not resolve, any of which may reach a
 * provider. `classReached`: a method nothing calls on a class that is used.
 * `via`: the way in a handler's verdict was read from. `seen` and
 * `neverSeen` are what the observed file says (P110): how often traffic went
 * through it in the window, or that it never did and how far that silence
 * can be trusted.
 */
export interface DeadEvidence {
  couldHit?: NearMiss[];
  oneOff?: OneOff[];
  outside?: string;
  callers?: number;
  caller?: string;
  missing?: 'consumer' | 'producer' | 'both';
  unresolvedInjects?: number;
  classReached?: true;
  via?: string;
  seen?: { count: number; lastSeen: string | null; window: string };
  neverSeen?: { window: string; confidence: NeverSeenConfidence };
}

/** How many near misses and calls one segment off a row names. */
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
  verdict: DeadVerdict;
  /** What could make the verdict wrong; present when it says anything. */
  evidence?: DeadEvidence;
}

export interface DeadChannel {
  id: string;
  producers: string[];
  consumers: string[];
  reason: string;
  verdict: DeadVerdict;
  evidence: DeadEvidence;
}

export interface DeadProvider {
  id: string;
  service: string;
  file?: string;
  line?: number;
  reason: string;
  verdict: DeadVerdict;
  evidence?: DeadEvidence;
}

/** A method nothing calls (P95), only for `dead` asked about methods. */
export interface DeadMethod {
  id: string;
  service: string;
  file?: string;
  line?: number;
  reason: string;
  verdict: DeadVerdict;
  evidence?: DeadEvidence;
}

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
  /** What `flowatlas observe` wrote beside the database (P110): traffic is evidence for each verdict. */
  observed?: ObservedInput;
  /** The window the evidence is read over (`7d`); absent, everything the file holds. */
  since?: string;
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
 * `--max` cuts from the bottom of. Within the actionable rows, the verdict
 * orders them: the rows nothing could reach, then those a call read in part
 * could (`likely-dead`), then those a call one segment off names (`unknown`).
 */
const RANKS: Readonly<Record<EntryClassName, number>> = { actionable: 0, stream: 3, infrastructure: 4, declared: 5 };

const VERDICT_STEP: Readonly<Record<DeadVerdict, number>> = { dead: 0, 'likely-dead': 1, unknown: 2, alive: 2 };

const rankOf = (row: Pick<DeadEntry, 'class' | 'verdict'>): number =>
  RANKS[row.class] + (row.class === 'actionable' ? VERDICT_STEP[row.verdict] : 0);

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

/** A call that found no route: the verb, the addresses it may ask for, and the service it aims at, if it says. */
interface Unjoined {
  call: GraphNode;
  method: string | null;
  paths: string[];
  service?: string;
}

/** How a row names the service a call aims at, where the call does not say so itself. */
const TARGET_SAID = /^target service (\S+) has no route/;

/** Every call the build found no route for (`target-route-not-found`), read once per answer. */
const unjoinedCalls = (db: GraphDb): Unjoined[] =>
  db.allUnresolved().flatMap((row) => {
    if (row.reason !== 'target-route-not-found' || row.node === null) return [];
    const call = db.node(row.node);
    if (call === undefined) return [];
    const said = call.meta?.['targetService'];
    const service = typeof said === 'string' ? said : TARGET_SAID.exec(row.message)?.[1];
    const choices = call.meta?.['pathChoices'];
    const path = call.meta?.['path'];
    const paths = Array.isArray(choices)
      ? choices.filter((choice): choice is string => typeof choice === 'string')
      : typeof path === 'string'
        ? [path]
        : [];
    const method = call.meta?.['method'];
    return [{ call, method: typeof method === 'string' ? method : null, paths, ...(service === undefined ? {} : { service }) }];
  });

/**
 * What a route nothing calls is read against (P91, P95), gathered once per
 * answer: the near misses the build recorded and the calls that found no
 * route, so a list of a hundred routes reads the rows once.
 */
interface RouteContext {
  readonly db: GraphDb;
  readonly options: DeadOptions;
  nearMissesOf(id: string): NearMiss[];
  oneOffsOf(route: GraphNode): OneOff[];
}

const routeContext = (db: GraphDb, report: LinkReport | undefined, options: DeadOptions): RouteContext => {
  // The calls the build found could still reach each route (P91), named
  // rather than re-matched here, so the command and the report agree.
  const nearMissed = report?.routes.nearMissed ?? {};
  let unjoined: Unjoined[] | undefined;
  return {
    db,
    options,
    nearMissesOf: (id) =>
      (Object.hasOwn(nearMissed, id) ? (nearMissed[id] ?? []) : []).slice(0, NEAR_MISSES_NAMED).flatMap((callId) => {
        const call = db.node(callId);
        if (call === undefined) return [];
        return [{ call: callId, path: String(call.meta?.['path'] ?? '?'), ...located(call) }];
      }),
    oneOffsOf: (route) => {
      unjoined ??= unjoinedCalls(db);
      const found: OneOff[] = [];
      for (const item of unjoined) {
        if (item.service !== undefined && item.service !== route.repo) continue;
        for (const path of item.paths) {
          const differs = oneSegmentOff(item.method, path, route);
          if (differs === undefined) continue;
          found.push({ call: item.call.id, asks: `${item.method ?? '?'} ${path}`, differs, ...located(item.call) });
          break;
        }
        if (found.length >= NEAR_MISSES_NAMED) break;
      }
      return found;
    },
  };
};

/**
 * The verdict a route nothing calls gets, and what it rests on (P95).
 *
 * Every class but `actionable` has its callers outside the project for a
 * reason the row names, so the graph's silence says nothing: `unknown`, with
 * what is outside. An actionable route a call one segment off names is
 * `unknown` too - renamed, or a typo, which only a person can tell - and one a
 * call read in part could reach is `likely-dead` (I3). The rest are `dead`.
 */
const routeVerdict = (
  found: RouteClass,
  couldHit: readonly NearMiss[],
  oneOff: readonly OneOff[],
): { verdict: DeadVerdict; evidence: DeadEvidence } => {
  const evidence: DeadEvidence = {
    ...(couldHit.length === 0 ? {} : { couldHit: [...couldHit] }),
    ...(oneOff.length === 0 ? {} : { oneOff: [...oneOff] }),
  };
  if (found.class !== 'actionable') return { verdict: 'unknown', evidence: { ...evidence, outside: found.role ?? found.class } };
  if (oneOff.length > 0) return { verdict: 'unknown', evidence };
  return { verdict: couldHit.length > 0 ? 'likely-dead' : 'dead', evidence };
};

/** One route nothing calls, as a row: its class, why, and its verdict with the evidence. */
const routeRow = (context: RouteContext, node: GraphNode): DeadEntry => {
  const { db, options } = context;
  const handler = db.edgesFrom(node.id, ['handles']).map((edge) => db.node(edge.to)?.label).find((label) => label !== undefined);
  const found = classifyRoute(routeFactsOf(node, handler), options);
  const couldHit = context.nearMissesOf(node.id);
  const oneOff = found.class === 'actionable' ? context.oneOffsOf(node) : [];
  const { verdict, evidence } = routeVerdict(found, couldHit, oneOff);
  return {
    id: node.id,
    service: node.repo,
    kind: node.kind ?? 'http',
    key: keyOf(node.id),
    ...located(node),
    reason:
      couldHit.length === 0 && oneOff.length === 0
        ? found.reason
        : `${found.reason}; ${oneOff.length === 0 ? 'a request whose address was read in part could reach it' : 'a request that found no route is one segment off it'}`,
    class: found.class,
    why: found.why,
    ...(found.role === undefined ? {} : { role: found.role }),
    confidence: couldHit.length === 0 ? 'dead' : 'likely-dead',
    verdict,
    ...(Object.keys(evidence).length === 0 ? {} : { evidence }),
  };
};

/** A handler whose channel nothing publishes to: the finding the command is for, ranked with the routes nothing explains. */
const silentHandlerRow = (node: GraphNode, entryId: string, channel: string): DeadEntry => ({
  id: entryId,
  service: node.repo,
  kind: node.kind ?? 'event',
  key: keyOf(entryId),
  ...located(node),
  reason: `${channel} has no publisher in any repo`,
  class: 'actionable',
  why: 'no publisher read',
  confidence: 'dead',
  verdict: 'dead',
  evidence: { missing: 'producer', via: channel },
});

/** The traffic overlay the options ask for, or none without an observed file. */
const trafficFor = (db: GraphDb, options: DeadOptions): TrafficOverlay | undefined =>
  options.observed === undefined ? undefined : trafficOverlay(db, options.observed, options.since);

const times = (n: number): string => `${n} time${n === 1 ? '' : 's'}`;

/**
 * A verdict with what traffic says of it (P110), the static answer kept
 * otherwise. Seen in the window is `alive` whatever the static answer, and
 * where that was `dead` the reason says static reach missed a caller. Never
 * seen, with nothing in the code reaching it and busy neighbours, turns an
 * `unknown` into `likely-dead`; every other never-seen row keeps its verdict
 * and gains the silence as evidence. No observed file: exactly P95's answer.
 */
const withTraffic = <T extends { verdict: DeadVerdict; reason: string; evidence?: DeadEvidence }>(
  row: T,
  id: string,
  traffic: TrafficOverlay | undefined,
): T => {
  if (traffic === undefined) return row;
  const seen = traffic.seenOf(id);
  if (seen !== undefined) {
    const said = `seen ${times(seen.count)} in ${traffic.window.label} at run time`;
    const reason =
      row.verdict === 'alive'
        ? row.reason
        : `${row.reason}; ${said}${row.verdict === 'unknown' ? '' : ', so something static reach does not see calls it (a blind spot)'}`;
    return {
      ...row,
      verdict: 'alive',
      reason,
      evidence: { ...row.evidence, seen: { count: seen.count, lastSeen: seen.lastSeen, window: traffic.window.label } },
    };
  }
  const never = traffic.neverOf(id);
  if (never === undefined) return row;
  const evidence: DeadEvidence = { ...row.evidence, neverSeen: { window: never.window, confidence: never.confidence } };
  if (row.verdict === 'unknown' && never.reachableFrom === 'outside' && never.confidence === 'strong') {
    const { seen: busy, of, most } = never.neighbours;
    return {
      ...row,
      verdict: 'likely-dead',
      reason: `${row.reason}; never seen in ${never.window} while ${busy} of its ${of} neighbour${of === 1 ? '' : 's'} ${busy === 1 ? 'was' : 'were'}, the busiest ${times(most)}`,
      evidence,
    };
  }
  return { ...row, evidence };
};

/**
 * Routes nothing in the project calls, and handlers whose channel is silent.
 *
 * A public API with no internal callers is not dead, which is why every row
 * carries a reason and a verdict with its evidence. Externally triggered kinds
 * are left out entirely: reporting them would drown the rows that mean
 * something.
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

  const context = routeContext(db, report, options);
  const rows: DeadEntry[] = [];
  for (const id of uncalled) {
    const node = db.node(id);
    if (node === undefined || !inService(node, options.service)) continue;
    // The build lists http routes only. The guard is here so that widening it
    // later cannot quietly start reporting a cron job as unreachable.
    if (excluded.has(node.kind ?? '')) continue;
    rows.push(routeRow(context, node));
  }
  for (const channel of report?.channels.noProducers ?? []) {
    for (const edge of db.edgesFrom(channel, ['consumes'])) {
      const consumer = db.node(edge.to);
      const entryId = consumer?.meta?.['entryId'];
      if (typeof entryId !== 'string') continue;
      const node = db.node(entryId);
      if (node === undefined || excluded.has(node.kind ?? '')) continue;
      if (!inService(node, options.service)) continue;
      rows.push(silentHandlerRow(node, entryId, channel));
    }
  }

  // Rank first, then id. `--max` cuts from the bottom, so what it cuts is the
  // rows that say why they are here rather than the rows that do not.
  const traffic = trafficFor(db, options);
  const read = traffic === undefined ? rows : rows.map((row) => withTraffic(row, row.id, traffic));
  const wanted = options.class === undefined ? read : read.filter((row) => row.class === options.class);
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

  /**
   * A channel missing an end is `dead` as a route nothing calls is: the end
   * it has talks to nothing in the project. One whose publisher serves event
   * streams is `unknown`: its consumer may be a browser holding one open.
   */
  const record = (id: string, end: 'consumer' | 'producer', reason: (producers: readonly string[]) => { said: string; streams: boolean }): void => {
    const producers = producersOf(db, id);
    const consumers = servicesOf(
      db,
      db.edgesFrom(id, ['consumes']).map((edge) => edge.to),
    );
    if (options.service !== undefined && ![...producers, ...consumers].includes(options.service)) return;
    const existing = rows.get(id);
    const { said, streams } = reason(producers);
    const missing = existing?.evidence.missing === undefined || existing.evidence.missing === end ? end : 'both';
    const outside = streams || existing?.evidence.outside === 'stream';
    rows.set(id, {
      id,
      producers,
      consumers,
      reason: existing === undefined ? said : `${existing.reason}; ${said}`,
      verdict: outside ? 'unknown' : 'dead',
      evidence: { missing, ...(outside ? { outside: 'stream' } : {}) },
    });
  };

  // A channel whose service also serves streams has a consumer the graph cannot
  // reach: the browser holding one open. Saying "no consumer in any repo" there
  // reads as "delete the publisher", and deleting it takes a live screen down.
  // Read once, and only when there is a channel to say it about.
  let streamed: ReadonlyMap<string, number> | undefined;
  for (const id of report.channels.noConsumers) {
    record(id, 'consumer', (producers) => {
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
        ? { said: 'no consumer in any repo', streams: false }
        : {
            said: `no consumer in any repo; ${most.service} serves ${most.streams} event stream${most.streams === 1 ? '' : 's'}, whose consumers are not read yet`,
            streams: true,
          };
    });
  }
  for (const id of report.channels.noProducers) record(id, 'producer', () => ({ said: 'no producer in any repo', streams: false }));

  const traffic = trafficFor(db, options);
  return [...rows.values()]
    .map((row) => withTraffic(row, row.id, traffic))
    .sort((a, b) => byId(a.id, b.id));
};

/** What the providers are read against, gathered once per answer. */
interface ProviderContext {
  readonly owners: ReadonlyMap<string, string[]>;
  readonly exported: ReadonlyMap<string, ReadonlySet<string>>;
  readonly registered: ReadonlyMap<string, ReadonlySet<string>>;
  readonly unresolvedInjects: ReadonlyMap<string, number>;
}

const providerContext = (db: GraphDb): ProviderContext => {
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
  return { owners: methodsByOwner(db), exported, registered, unresolvedInjects };
};

/** The edges that say something reaches a method: a route handing it work, or a call. */
const METHOD_CALLERS = ['handles', 'calls'] as const;

/** Something reaches it: how many edges, and the first caller by id. */
const aliveBy = (edges: ReadonlyArray<{ from: string }>): DeadEvidence => ({
  callers: edges.length,
  caller: [...edges].map((edge) => edge.from).sort(byId)[0] ?? '',
});

interface Answered {
  verdict: DeadVerdict;
  reason: string;
  evidence: DeadEvidence;
}

/**
 * The verdict on one class (P95), the rule `dead --kind providers` lists by.
 *
 * A class from a library and one its module exports have their users outside
 * what the injects edge sees: `unknown`. Injected, or a method of it reached:
 * `alive`. Otherwise nothing reaches it, and it is `likely-dead` where the
 * service has injects the reader could not resolve - any of them may be it -
 * and `dead` where it has none.
 */
const providerAnswer = (db: GraphDb, context: ProviderContext, provider: GraphNode): Answered => {
  if (provider.kind === 'external') {
    return { verdict: 'unknown', reason: "a class from a library; what uses it is the library's business", evidence: { outside: 'library' } };
  }
  if (context.exported.get(provider.repo)?.has(provider.label) === true) {
    return { verdict: 'unknown', reason: 'its module exports it; whatever imports the module may inject it', evidence: { outside: 'exported' } };
  }
  const injectors = db.edgesTo(provider.id, ['injects']);
  if (injectors.length > 0) return { verdict: 'alive', reason: 'injected', evidence: aliveBy(injectors) };
  const reaching = (context.owners.get(provider.id) ?? []).flatMap((method) => db.edgesTo(method, METHOD_CALLERS));
  if (reaching.length > 0) return { verdict: 'alive', reason: 'its methods are reached', evidence: aliveBy(reaching) };

  const unresolved = context.unresolvedInjects.get(provider.repo) ?? 0;
  // A class no module even registers is not built by the container at all, so
  // whatever wires it does so somewhere this graph does not reach: a
  // bootstrap call, a hand-written `new`. Worth saying, because it is the
  // difference between "delete this" and "look in main.ts".
  const wiredElsewhere = context.registered.get(provider.repo)?.has(provider.label) !== true;
  return {
    verdict: unresolved === 0 ? 'dead' : 'likely-dead',
    reason:
      'nothing injects it and nothing reaches its methods' +
      (wiredElsewhere ? '; no module registers it either — check the bootstrap file' : '') +
      (unresolved === 0 ? '' : `; ${provider.repo} has ${unresolved} unresolved injects — verify`),
    evidence: unresolved === 0 ? {} : { unresolvedInjects: unresolved },
  };
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
  const context = providerContext(db);
  const rows: DeadProvider[] = [];
  for (const provider of db.nodesByType('provider')) {
    if (!inService(provider, options.service)) continue;
    if (provider.kind === 'controller') continue;
    const answered = providerAnswer(db, context, provider);
    if (answered.verdict !== 'dead' && answered.verdict !== 'likely-dead') continue;
    rows.push({
      id: provider.id,
      service: provider.repo,
      ...located(provider),
      reason: answered.reason,
      verdict: answered.verdict,
      ...(Object.keys(answered.evidence).length === 0 ? {} : { evidence: answered.evidence }),
    });
  }

  return rows.sort((a, b) => byId(a.id, b.id));
};

/**
 * The verdict on one method (P95): reached when a route hands it work or
 * something calls it. One nothing reaches is `dead` when its class is not
 * reached either, and `likely-dead` when the class is used - injected, or
 * another method of it called - since a call through a receiver the reading
 * could not type may be the one that reaches it (I3).
 */
const methodAnswer = (db: GraphDb, context: ProviderContext, method: GraphNode): Answered => {
  const reaching = db.edgesTo(method.id, METHOD_CALLERS);
  if (reaching.length > 0) return { verdict: 'alive', reason: 'called', evidence: aliveBy(reaching) };
  const owner = ownerOf(method.id);
  const holder = owner === undefined ? undefined : db.node(owner);
  if (holder === undefined) return { verdict: 'likely-dead', reason: 'nothing calls it; it belongs to no class the graph holds', evidence: {} };
  const used = providerAnswer(db, context, holder);
  if (used.verdict === 'alive' || used.verdict === 'unknown') {
    return {
      verdict: 'likely-dead',
      reason: `nothing calls it, though its class is ${used.verdict === 'alive' ? 'used' : 'reached from outside'}: a call through a receiver the reading could not type may`,
      evidence: { classReached: true, ...(used.evidence.outside === undefined ? {} : { outside: used.evidence.outside }) },
    };
  }
  return { verdict: used.verdict, reason: `nothing calls it and its class is not reached (${used.reason})`, evidence: used.evidence };
};

/**
 * Methods nothing calls (P95), for `dead` asked about methods: every method
 * with no route handing it work and no caller, with its verdict. A class
 * nothing reaches is listed by `deadProviders` already, so its methods say
 * `dead` here too.
 */
export const deadMethods = (db: GraphDb, options: DeadOptions = {}): DeadMethod[] => {
  const context = providerContext(db);
  const traffic = trafficFor(db, options);
  const rows: DeadMethod[] = [];
  for (const method of db.nodesByType('method')) {
    if (!inService(method, options.service)) continue;
    const owner = ownerOf(method.id);
    const holder = owner === undefined ? undefined : db.node(owner);
    if (holder?.kind === 'external') continue;
    const answered = withTraffic(methodAnswer(db, context, method), method.id, traffic);
    if (answered.verdict === 'alive') continue;
    rows.push({
      id: method.id,
      service: method.repo,
      ...located(method),
      reason: answered.reason,
      verdict: answered.verdict,
      ...(Object.keys(answered.evidence).length === 0 ? {} : { evidence: answered.evidence }),
    });
  }
  return rows.sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || byId(a.id, b.id));
};

/** The order verdicts are listed in: the claims to act on first. */
export const VERDICT_ORDER: Readonly<Record<DeadVerdict, number>> = { dead: 0, 'likely-dead': 1, unknown: 2, alive: 3 };

/** The better of two verdicts, for a class answered by its routes: alive beats unknown beats likely-dead beats dead. */
const livelier = (a: DeadVerdict, b: DeadVerdict): DeadVerdict => (VERDICT_ORDER[a] >= VERDICT_ORDER[b] ? a : b);

/** What `dead` answers about one node (P95): the verdict, why, and what could make it wrong. */
export interface DeadAnswer {
  id: string;
  type: string;
  kind?: string;
  service?: string;
  file?: string;
  line?: number;
  verdict: DeadVerdict;
  reason: string;
  class?: EntryClassName;
  role?: InfrastructureRole;
  evidence: DeadEvidence;
}

/** The edges that reach a way in that is not a route: a publish onto its channel, a trigger, a step. */
const ENTRY_CALLERS = ['http_calls', 'hits', 'triggers', 'consumes', 'calls'] as const;

const entryAnswer = (db: GraphDb, report: LinkReport | undefined, context: RouteContext, entry: GraphNode): Answered & Partial<Pick<DeadEntry, 'class' | 'role'>> => {
  const kind = entry.kind ?? '';
  if ((EXTERNALLY_TRIGGERED as readonly string[]).includes(kind)) {
    return { verdict: 'unknown', reason: `a ${kind} way in is triggered from outside the graph`, evidence: { outside: kind } };
  }
  if (kind === 'http') {
    const callers = db.edgesTo(entry.id, ['http_calls', 'hits']);
    if (callers.length > 0) return { verdict: 'alive', reason: 'called', evidence: aliveBy(callers) };
    const row = routeRow(context, entry);
    return { verdict: row.verdict, reason: row.reason, evidence: row.evidence ?? {}, class: row.class, ...(row.role === undefined ? {} : { role: row.role }) };
  }
  // A handler of a channel is reached through its consumer node, which the
  // channel's publishers reach: alive when one publishes, dead when the build
  // found none in any repo (as `deadEntries` lists it).
  const consumers = db.nodesByType('consumer').filter((node) => node.meta?.['entryId'] === entry.id);
  const channels = consumers.flatMap((consumer) => db.edgesTo(consumer.id, ['consumes']).map((edge) => edge.from));
  const publishers = channels.flatMap((channel) => db.edgesTo(channel, ['emits']));
  if (publishers.length > 0) return { verdict: 'alive', reason: 'something publishes to its channel', evidence: { ...aliveBy(publishers), via: channels[0] ?? '' } };
  const silent = channels.find((channel) => report?.channels.noProducers.includes(channel) === true);
  if (silent !== undefined) {
    const row = silentHandlerRow(entry, entry.id, silent);
    return { verdict: row.verdict, reason: row.reason, evidence: row.evidence ?? {}, class: row.class };
  }
  const callers = db.edgesTo(entry.id, ENTRY_CALLERS);
  if (callers.length > 0) return { verdict: 'alive', reason: 'reached', evidence: aliveBy(callers) };
  return { verdict: 'unknown', reason: `nothing in the graph reaches it, and a ${kind || 'way in'} of this kind is not judged`, evidence: {} };
};

const channelAnswer = (db: GraphDb, report: LinkReport | undefined, channel: GraphNode): Answered => {
  const producers = db.edgesTo(channel.id, ['emits']);
  const consumers = db.edgesFrom(channel.id, ['consumes']);
  if (producers.length > 0 && consumers.length > 0) {
    return { verdict: 'alive', reason: 'published and consumed', evidence: aliveBy(producers) };
  }
  const row = deadChannels(db, report).find((found) => found.id === channel.id);
  if (row !== undefined) return { verdict: row.verdict, reason: row.reason, evidence: row.evidence };
  return {
    verdict: 'dead',
    reason: producers.length === 0 ? 'no producer in any repo' : 'no consumer in any repo',
    evidence: { missing: producers.length === 0 && consumers.length === 0 ? 'both' : producers.length === 0 ? 'producer' : 'consumer' },
  };
};

/**
 * A controller is reached through its routes: its verdict is the liveliest
 * of theirs, with the route that decided it. One no route hands work to is
 * judged as any other class.
 */
const controllerAnswer = (db: GraphDb, report: LinkReport | undefined, context: RouteContext, providers: ProviderContext, controller: GraphNode): Answered => {
  const routes = (providers.owners.get(controller.id) ?? [])
    .flatMap((method) => db.edgesTo(method, ['handles']).map((edge) => edge.from))
    .sort(byId)
    .flatMap((id) => {
      const node = db.node(id);
      return node === undefined ? [] : [node];
    });
  if (routes.length === 0) return providerAnswer(db, providers, controller);
  let best: { route: GraphNode; answered: Answered } | undefined;
  for (const route of routes) {
    const answered = entryAnswer(db, report, context, route);
    if (best === undefined || livelier(best.answered.verdict, answered.verdict) !== best.answered.verdict) best = { route, answered };
  }
  const decided = best!;
  return {
    verdict: decided.answered.verdict,
    reason: `${routes.length} route${routes.length === 1 ? '' : 's'} hand${routes.length === 1 ? 's' : ''} it work; the liveliest is ${decided.answered.verdict}`,
    evidence: { via: decided.route.id, ...decided.answered.evidence },
  };
};

/**
 * Whether one node is dead, and what could make that wrong (P95).
 *
 * The one rule `dead` lists by, asked of a single node: a way in, a channel,
 * a class, a method or a function. The list functions above and this answer
 * share every predicate, so `flowatlas dead` and the MCP tool cannot disagree.
 * Anything else is `unknown`, said as a type `dead` does not judge.
 */
export const deadVerdict = (
  db: GraphDb,
  report: LinkReport | undefined,
  id: string,
  options: DeadOptions = {},
): DeadAnswer | undefined => {
  const node = db.node(id);
  if (node === undefined) return undefined;
  const context = routeContext(db, report, options);
  const providers = (): ProviderContext => providerContext(db);
  const statically: Answered & Partial<Pick<DeadEntry, 'class' | 'role'>> =
    node.type === 'entry'
      ? entryAnswer(db, report, context, node)
      : node.type === 'channel'
        ? channelAnswer(db, report, node)
        : node.type === 'provider'
          ? node.kind === 'controller'
            ? controllerAnswer(db, report, context, providers(), node)
            : providerAnswer(db, providers(), node)
          : node.type === 'method'
            ? methodAnswer(db, providers(), node)
            : node.type === 'function'
              ? functionAnswer(db, node)
              : { verdict: 'unknown', reason: `dead judges ways in, channels, classes, methods and functions, not a ${node.type}`, evidence: {} };
  const answered = withTraffic(statically, node.id, trafficFor(db, options));
  return {
    id: node.id,
    type: node.type,
    ...(node.kind === undefined ? {} : { kind: node.kind }),
    ...(node.repo === '' ? {} : { service: node.repo }),
    ...located(node),
    verdict: answered.verdict,
    reason: answered.reason,
    ...(answered.class === undefined ? {} : { class: answered.class }),
    ...(answered.role === undefined ? {} : { role: answered.role }),
    evidence: answered.evidence ?? {},
  };
};

/** A function is reached by a call; one nothing calls may be imported by code the reading did not follow. */
const functionAnswer = (db: GraphDb, fn: GraphNode): Answered => {
  const reaching = db.edgesTo(fn.id, METHOD_CALLERS);
  if (reaching.length > 0) return { verdict: 'alive', reason: 'called', evidence: aliveBy(reaching) };
  return { verdict: 'likely-dead', reason: 'nothing calls it; an import the reading did not follow may', evidence: {} };
};

/** How many DI findings each service has, for the banner `dead` prints. */
export const unresolvedInjectCount = (db: GraphDb, service?: string): number =>
  db
    .unresolved({ limit: 100_000, ...(service === undefined ? {} : { service }) })
    .filter((row) => UNRESOLVED_INJECTS.includes(row.reason)).length;
