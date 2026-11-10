import { normalizePath, wasRead, type GraphNode } from '@flowatlas/core';
import type { BaseUrlAnswer, FoundValue } from './base-url-value.js';
import { localGraphqlEndpoint, sendsOperation, unservedFinding } from './graphql-value.js';
import { MARKER_FINDINGS, pathOfValue, unreadRouteFinding, type Finding } from './http-link.js';
import { portClosedFinding, portSharedFinding, type ClosedPort, type Listening, type PortAnswer } from './local-port.js';
import { defaultPortOf, forwardedAgain, proxiedOutFinding, proxyChainFinding, PROXY_HOPS, type Forward } from './proxy-forward.js';
import { cmp } from './order.js';
import {
  behindUnread,
  callingApplication,
  catchAllBehind,
  isMatch,
  matchRoute,
  verbsAnswering,
  type RouteResult,
} from './route-match.js';

/**
 * What the linker can be asked while resolving one request made in a browser.
 *
 * Passed in rather than reached for, so resolving a call is a question about
 * these four lookups and nothing else, and can be asked in a test without a
 * project behind it.
 */
export interface UiIndex {
  /** Routes a service serves. Empty when it serves none, undefined when unknown. */
  routesOf(service: string): readonly GraphNode[] | undefined;
  /** The service a frontend's settings key names, when the configuration says so. */
  targetOf(repo: string, env: string): string | undefined;
  /** Services declaring a settings key as their own base. */
  claimantsOf(env: string): readonly string[];
  /** Every service that serves routes, for the last-resort search. */
  services(): readonly string[];
  /** What the value the request's settings key is given says its base address is (P77). */
  baseUrlOf?(call: GraphNode): BaseUrlAnswer | undefined;
  /** The configured service a name or an alias stands for, or undefined when none answers to it (P127). */
  serviceOf?(name: string): string | undefined;
  /** Every alias configured, for the row that says a name answers to none. */
  aliases?(): readonly string[];
  /**
   * The one configured service a host is reached at, and whether the
   * configuration says so (its name, an alias, `services[].hosts`) or only the
   * services' own setting files do (P239).
   */
  serviceAtHost?(host: string, defaultPort?: number): PortAnswer | undefined;
  /** How a service's server forwards a path to another server, where its proxy does (P257). */
  forwardOf?(service: string, path: string): Forward | undefined;
  /** How a cluster's way in forwards a request to a public host, where one does (P260). */
  ingressOf?(host: string, path: string): Forward | undefined;
  /** The public hosts a cluster's ways in serve a service's pages at (P260). */
  publicHostsOf?(service: string): readonly string[];
}

/**
 * How the service on the other end was decided.
 *
 * `same-service` is the browser asking the server it was served from, which is
 * what a relative address means and by far the commonest shape there is. It
 * ranks with the two configured answers rather than with the guess: a path that
 * matches a route in the very repository the call was written in is evidence
 * from one reading of one directory, and nothing about it is a guess (R93).
 * `marker` is an annotation naming the service, `@flowatlas-calls catalog GET
 * /items`, which outranks all of them (P127).
 */
export type UiVia = 'marker' | 'api-target' | 'base-url-env' | 'base-url-value' | 'host' | 'proxy' | 'ingress' | 'same-service' | 'unique-route' | 'graphql-path';

/** What each way a request can end carries with it. */
interface Details {
  linked: {
    via: UiVia;
    entry: GraphNode;
    targetService: string;
    runnersUp: readonly string[];
    /** The settings whose part of the route's address was taken as empty (R144). */
    mountAssumed?: readonly string[];
    /** The value the base address was taken from, where a setting's value decided it (P77). */
    baseUrl?: FoundValue;
    /** The host was found only in the services' own setting files, not in the configuration (P239). */
    hostFromFiles?: true;
    /** Where the service's server is started on the port an address on this machine names (P250). */
    listening?: Listening;
    /** The proxy rule the request was forwarded by, and how (P257). */
    proxied?: Forward;
  };
  /** Two or more services listen on the port an address on this machine names (P250). */
  portShared: { port: number; said: readonly string[]; services: readonly string[] };
  /** A host on a network names the service at a port it is not reached at there (P257). */
  portClosed: { host: string; closed: ClosedPort };
  /** A service's proxy forwards the request to a host no service of the project is reached at (P257). */
  proxiedOut: { service: string; forward: Forward };
  /** The request is forwarded through more servers than are followed, or in a circle (P260). */
  proxyChain: { services: readonly string[]; loop: boolean };
  /** The address or the verb is only known at run time; the extractor said so. */
  dynamic: { reason: string };
  /** No route answers. `targetService` is null when nothing named one to ask. */
  noRoute: {
    targetService: string | null;
    method: string;
    path: string;
    /** The proxy rule that forwarded the request to the service, where one did (P257). */
    proxied?: Forward;
    verbs: readonly string[];
    /**
     * Routes that would answer if the part of their own address nobody read
     * were left open, as `service METHOD path`. Never a join: see
     * {@link behindUnread}.
     */
    unread: readonly string[];
    /** The service was the one an annotation named, so it is the annotation that is wrong (P127). */
    named?: true;
    /** The root fields an operation asks for that the GraphQL endpoint at the path neither declares nor resolves (P281). */
    unserved?: readonly string[];
  };
  /** An annotation names a service nothing configured answers to, by name or alias (P127). */
  serviceUnknown: { service: string; aliases: readonly string[] };
  /**
   * More than one thing answers, and nothing says which one is meant.
   *
   * Two services, or — since R119 — two applications inside one service. The
   * candidates are named either way; `applications` is what says which of the two
   * questions this is, because they are not the same question and the second one
   * has nothing wrong with it to fix.
   */
  ambiguous: {
    method: string;
    path: string;
    candidates: readonly string[];
    applications?: readonly string[];
  };
}

export type UiOutcomeKind = keyof Details;

export type UiOutcome = { [K in UiOutcomeKind]: { kind: K } & Details[K] }[UiOutcomeKind];

/** A request nothing serves, as far as anything read says. */
const missingRoute = ({ targetService, method, path, verbs }: Details['noRoute']): Finding => ({
  reason: 'target-route-not-found',
  message:
    targetService === null
      ? `no configured service serves ${method} ${path}`
      : `target service ${targetService} has no route ${method} ${path}`,
  hint:
    `${verbs.length === 0 ? '' : `That path answers ${verbs.join(', ')}. `}` +
    (targetService === null
      ? `Add the service that answers it to services[], or annotate the method with /** @flowatlas-calls ${method} ${path} */.`
      : `Route renamed? Check ${targetService}'s controllers, or annotate the method with /** @flowatlas-calls ${method} ${path} */.`),
});

/**
 * What each outcome means to whoever reads the report.
 *
 * A table rather than a chain of branches: adding a way for a request to end
 * means adding a row here and a row in `Details`, and nothing else changes.
 */
const FINDINGS: { [K in UiOutcomeKind]: ((detail: Details[K]) => Finding) | null } = {
  linked: null,
  dynamic: null,
  noRoute: (detail) => {
    if (detail.unserved !== undefined && detail.targetService !== null) return unservedFinding(detail.targetService, detail.method, detail.path, detail.unserved);
    if (detail.named === true && detail.targetService !== null) {
      return MARKER_FINDINGS.routeNotFound({ ...detail, service: detail.targetService }, '@flowatlas-calls');
    }
    return detail.unread.length === 0 ? missingRoute(detail) : unreadRouteFinding(detail);
  },
  serviceUnknown: (detail) => MARKER_FINDINGS.serviceUnknown(detail, detail.aliases, '@flowatlas-calls'),
  portShared: ({ port, said }) => portSharedFinding(port, said),
  portClosed: ({ host, closed }) => portClosedFinding(host, closed),
  proxiedOut: ({ service, forward }) => proxiedOutFinding(service, forward),
  proxyChain: ({ services, loop }) => proxyChainFinding(services, loop),
  ambiguous: (detail) => AMBIGUITY[detail.applications === undefined ? 'target' : 'application'](detail),
};

/**
 * Which ambiguity a request ran into, by whether the answers differ by
 * application.
 *
 * Two services answering is a question the configuration settles, and the hint
 * says which setting. Two applications of one service answering is not a question
 * any setting can settle: they listen on their own ports and whatever routes to
 * them from outside the browser is not in this project's source. Spelling the two
 * the same way sent a reader to `apiTarget` to fix something `apiTarget` has no
 * word for.
 */
const AMBIGUITY: Record<
  'target' | 'application',
  (detail: Details['ambiguous']) => Finding
> = {
  target: ({ method, path, candidates }) => ({
    reason: 'ambiguous-route-target',
    message: `${candidates.join(' and ')} both answer ${method} ${path}`,
    hint: 'Set services[].apiTarget on the frontend to say which service its settings key names.',
  }),
  application: ({ method, path, applications = [] }) => ({
    reason: 'ambiguous-route-application',
    message: `${applications.length} applications serve ${method} ${path}: ${applications.join(', ')}`,
    hint: `Nothing is wrong with the route, and nothing here can choose between them: which of ${applications.join(' and ')} a request reaches is decided by how they are deployed, and no source says.`,
  }),
};

/** The finding an outcome carries, or nothing when the request resolved cleanly. */
export const uiFindingFor = (outcome: UiOutcome): Finding | undefined => {
  const describe = FINDINGS[outcome.kind] as ((detail: UiOutcome) => Finding) | null;
  return describe === null ? undefined : describe(outcome);
};

/** The reason a request counts under, whether or not it produced a row. */
export const uiReasonOf = (outcome: UiOutcome): string | undefined =>
  outcome.kind === 'dynamic' ? outcome.reason : uiFindingFor(outcome)?.reason;

/**
 * The same call, once per value a closed segment of its address can take.
 *
 * `POST /orders/${id}/${action}` with `action: 'ship' | 'refund'` is two
 * addresses, and both of them are routes the target service serves. Read as one
 * `:param` it matched neither, fell through to the worker's catch-all, and was
 * reported as a front end asking for something the back end does not serve —
 * the most confident thing this tool says, said wrongly (R31).
 *
 * Each copy keeps the original's id, so an edge drawn from any of them is drawn
 * from the call that was written. A call with no such segment answers with
 * nothing, which is nearly every call.
 */
export const callPerChoice = (call: GraphNode): GraphNode[] | undefined => {
  const choices = call.meta?.['pathChoices'];
  if (!Array.isArray(choices) || choices.length < 2) return undefined;
  if (!choices.every((choice): choice is string => typeof choice === 'string')) return undefined;
  return choices.map((path) => ({ ...call, meta: { ...call.meta, path } }));
};

/** What is said when some of the addresses a call stands for reach no route. */
export const missingChoiceFinding = (
  method: string,
  missing: readonly string[],
  found: readonly string[],
): Finding => ({
  reason: 'target-route-not-found',
  message:
    `${method} ${missing.join(', ')} reaches no route, though ` +
    `${found.join(', ')} ${found.length === 1 ? 'does' : 'do'}`,
  hint:
    'The segment is written as a closed set of values and one of them has no route. ' +
    'A renamed or missing handler looks exactly like this; check the ones named.',
});

/** One request, with everything any way of answering it may look at. */
interface Ask {
  /** The call as written, which is the only thing that knows whose repository it is. */
  call: GraphNode;
  method: string;
  path: string;
  /** The settings key the address is rooted at, when it is rooted at one. */
  env: string | undefined;
  index: UiIndex;
}

/**
 * The service an annotation names, `@flowatlas-calls catalog GET /items`, by
 * its name or an alias (P127).
 *
 * First, and terminal for the same reason `apiTarget` is: somebody wrote down
 * which service the request goes to. A name nothing answers to is said as the
 * server's annotation says it, and so is a route the named service lacks.
 */
const byAnnotation = (ask: Ask): UiOutcome | undefined => {
  const { call, index } = ask;
  const service = call.meta?.['service'];
  if (typeof service !== 'string') return undefined;
  const named = index.serviceOf?.(service) ?? (index.routesOf(service) === undefined ? undefined : service);
  if (named === undefined) return { kind: 'serviceUnknown', service, aliases: index.aliases?.() ?? [] };
  const found = within(ask, named, 'marker');
  return found.kind === 'noRoute' ? { ...found, named: true } : found;
};

/** A settings entry naming the service this frontend's key stands for. */
const byApiTarget = (ask: Ask): UiOutcome | undefined => {
  const { call, env, index } = ask;
  const named = env === undefined ? undefined : index.targetOf(call.repo, env);
  // Terminal once a target is named, wrong answer included: somebody wrote down
  // which service that key means, and a search behind their back would only
  // hide the fact that the route they named is gone.
  return named === undefined ? undefined : within(ask, named, 'api-target');
};

/** Exactly one service declaring the same settings key as its own base. */
const byBaseUrlEnv = (ask: Ask): UiOutcome | undefined => {
  const { env, index } = ask;
  if (env === undefined) return undefined;
  const claiming = index.claimantsOf(env);
  return claiming.length === 1 ? within(ask, claiming[0] as string, 'base-url-env') : undefined;
};

/**
 * A GraphQL operation sent to a setting whose values name no configured
 * service (P281): the endpoint at the path its values for this machine agree
 * on, where it declares a root field the operation asks for
 * (`localGraphqlEndpoint`).
 */
const byLocalGraphqlValue = (ask: Ask, answer: BaseUrlAnswer | undefined): UiOutcome | undefined => {
  const found = localGraphqlEndpoint(ask.call, ask.path, answer, ask.index.services(), (service) => ask.index.routesOf(service));
  if (found === undefined) return undefined;
  if (found.kind === 'unserved') return { kind: 'noRoute', targetService: found.service, method: 'POST', path: found.path, verbs: [], unread: [], unserved: found.fields };
  return { kind: 'linked', via: 'graphql-path', entry: found.entry, targetService: found.service, runnersUp: [], baseUrl: found.found };
};

/**
 * The one service the value the settings key is given names, where nobody
 * claims the key (P77). A guess, the way a route found by its address alone
 * is: the value is the one the repository writes down for running it.
 */
const byBaseUrlValue = (ask: Ask): UiOutcome | undefined => {
  const { env, index } = ask;
  if (env === undefined || index.claimantsOf(env).length > 0) return undefined;
  const answer = index.baseUrlOf?.(ask.call);
  if (answer?.kind !== 'service') return byLocalGraphqlValue(ask, answer);
  // A value with a path of its own is where the request goes, path included
  // (P91); where that answers nothing and the path alone does, the value's
  // path is a mount and the join without it stands.
  const start = pathOfValue(answer.found);
  const whole = start === undefined ? undefined : within({ ...ask, path: normalizePath(`${start}/${ask.path}`) }, answer.service, 'base-url-value');
  const found = whole?.kind === 'linked' ? whole : within(ask, answer.service, 'base-url-value');
  if (found.kind === 'linked') return { ...found, baseUrl: answer.found };
  return whole ?? found;
};

/**
 * The service a host the address names outright is reached at (P239).
 *
 * `axios.create({ baseURL: 'https://orders.example.test' })` writes where every
 * request through it goes, and until the base was read the address had no host
 * at all. Once it has one, the configuration may say whose it is - a service's
 * name, an alias, `services[].hosts` - and that is as much somebody writing down
 * which service is meant as `apiTarget` is: terminal, and `static`. A host only
 * a service's own setting files name is the evidence P77 treats as a guess, and
 * the edge says so.
 */
const byHost = (ask: Ask): UiOutcome | undefined => {
  const { call, index } = ask;
  const host = call.meta?.['host'];
  if (typeof host !== 'string') return undefined;
  // A public host a cluster's way in matches the path on sends it to the
  // service behind it, whoever else the host names (P260).
  const way = index.ingressOf?.(host, ask.path);
  if (way !== undefined) return forwarded(ask, host, way);
  const found = index.serviceAtHost?.(host, defaultPortOf(call.meta?.['url']));
  if (found === undefined) return undefined;
  // Two services listen on the port this machine's address names (P250): no
  // way below may pick one of them by its route.
  if (found.kind === 'shared') return { kind: 'portShared', port: found.port, said: found.said, services: found.services };
  // A port the network does not reach the service at: it will not connect (P257).
  if (found.kind === 'closed') return { kind: 'portClosed', host: found.host, closed: found.closed };
  // A server whose proxy forwards the path hands it on, before its own routes
  // or after them as its framework does (P257).
  const forward = index.forwardOf?.(found.service, ask.path);
  if (forward !== undefined && forward.rule.after === undefined) return forwarded(ask, found.service, forward);
  const outcome = within(ask, found.service, 'host');
  if (outcome.kind === 'noRoute' && forward !== undefined) return forwarded(ask, found.service, forward);
  // A front end's dev server forwards what its own routes do not serve
  // (P254), by a proxy not read: which service answers is the next way's to say.
  if (outcome.kind === 'noRoute' && found.listening?.devServer === true) return undefined;
  if (outcome.kind !== 'linked') return outcome;
  return {
    ...outcome,
    ...(found.sure ? {} : { hostFromFiles: true as const }),
    ...(found.listening === undefined ? {} : { listening: found.listening }),
  };
};

/**
 * The request a server's proxy makes for a request it forwards (P257): the
 * service at the target's host, asked for the rewritten path, the join a
 * guess that names the rule. A host no service is reached at is a third
 * party, said as one.
 */
const forwarded = (ask: Ask, service: string, forward: Forward, passed: readonly string[] = [service]): UiOutcome => {
  const found = ask.index.serviceAtHost?.(forward.host, forward.defaultPort);
  if (found === undefined) return { kind: 'proxiedOut', service, forward };
  if (found.kind === 'shared') return { kind: 'portShared', port: found.port, said: found.said, services: found.services };
  if (found.kind === 'closed') return { kind: 'portClosed', host: found.host, closed: found.closed };
  const via = forward.via ?? 'proxy';
  // A server forwarded to may forward the request again, by its own rules (P260).
  const next = ask.index.forwardOf?.(found.service, forward.path);
  if (next !== undefined && (next.rule.after === undefined || within({ ...ask, path: forward.path }, found.service, via).kind === 'noRoute')) {
    const services = [...passed, found.service];
    if (passed.includes(found.service)) return { kind: 'proxyChain', services, loop: true };
    if (passed.length >= PROXY_HOPS) return { kind: 'proxyChain', services, loop: false };
    return forwarded(ask, found.service, forwardedAgain(forward, service, next), services);
  }
  const outcome = within({ ...ask, path: forward.path }, found.service, via);
  if (outcome.kind === 'noRoute') return { ...outcome, proxied: forward };
  if (outcome.kind !== 'linked') return outcome;
  return { ...outcome, proxied: forward, ...(found.listening === undefined ? {} : { listening: found.listening }) };
};

/**
 * A request written with no host, which the server its page is served from
 * forwards by its proxy (P257): a dev server's `/api` handed to the service
 * behind it. Before the caller's own routes are asked, unless the framework
 * applies the rule only to what its own routes do not serve.
 */
const byProxy = (ask: Ask): UiOutcome | undefined => {
  const { call, env, index } = ask;
  if (typeof call.meta?.['host'] === 'string' || env !== undefined) return undefined;
  const forward = index.forwardOf?.(call.repo, ask.path);
  if (forward === undefined) return undefined;
  if (forward.rule.after !== undefined && within(ask, call.repo, 'same-service').kind !== 'noRoute') return undefined;
  return forwarded(ask, call.repo, forward);
};

/**
 * A request written with no host from a service whose pages a cluster's way
 * in serves at a public host (P260): a request to that host, forwarded by the
 * way in as any request to it is. Where the service is served at several
 * hosts, only a path every one of them forwards alike is followed.
 */
const byIngress = (ask: Ask): UiOutcome | undefined => {
  const { call, env, index } = ask;
  if (typeof call.meta?.['host'] === 'string' || env !== undefined) return undefined;
  const hosts = index.publicHostsOf?.(call.repo) ?? [];
  const ways = hosts.flatMap((host) => {
    const way = index.ingressOf?.(host, ask.path);
    return way === undefined ? [] : [{ host, way }];
  });
  const first = ways[0];
  if (first === undefined || ways.length !== hosts.length) return undefined;
  if (ways.some(({ way }) => way.host !== first.way.host || way.path !== first.way.path)) return undefined;
  return forwarded(ask, first.host, first.way);
};

/**
 * The service the call was written in, answering its own browser.
 *
 * This is what a relative `fetch('/api/thing')` means, and until R93 it was the
 * one service excluded from the question. Nothing names a service in such a
 * call, so neither of the two ways above fires and this is the only reading
 * available — no line of configuration could have supplied one. On a scheduling app that
 * cost thirty-two requests every edge they had, and produced twenty-three rows
 * saying no configured service serves an address sitting in the same graph.
 *
 * It gives way rather than answering `noRoute`, because a frontend that also
 * serves routes may still be calling somebody else's: the caller's own service
 * not serving an address is no reason to stop looking for one that does.
 */
const bySameService = (ask: Ask): UiOutcome | undefined => {
  const own = within(ask, ask.call.repo, 'same-service');
  return own.kind === 'noRoute' ? undefined : own;
};

/**
 * Whether a service serves the address at all, which is not the same as knowing
 * which of its entries answers.
 *
 * A service whose own entries tie is a service that serves it: since R119 that
 * is the ordinary reading of a worker and an API in one repository both serving
 * `/health`. Asking for a single match here excluded such a service from the
 * search for who answers, and the request then came back as one no configured
 * service serves — a sentence that is false, about the wrong thing, and pointing
 * at the configuration rather than at the two applications.
 */
const answers = (result: RouteResult): boolean =>
  isMatch(result) || result.reason === 'ambiguous';

/**
 * Whoever happens to serve that route, when nothing said who should.
 *
 * A guess, and it comes back as one: the same address may be served by two
 * services for entirely different callers, so one candidate is a usable guess
 * and several is a question only the configuration can settle.
 */
const byUniqueRoute = (ask: Ask): UiOutcome | undefined => {
  const { method, path, index } = ask;
  const answering = index
    .services()
    .filter((service) => {
      const routes = index.routesOf(service) ?? [];
      const from = callerApplicationIn(ask, service);
      if (answers(matchRoute(method, path, routes, from))) return true;
      const prefixed = withGlobalPrefix(path, routes);
      return prefixed !== undefined && answers(matchRoute(method, prefixed, routes, from));
    })
    .sort(cmp);

  if (answering.length === 1) {
    return within(ask, answering[0] as string, 'unique-route');
  }
  return answering.length > 1 ? { kind: 'ambiguous', method, path, candidates: answering } : undefined;
};

/**
 * The ways one request's answering service can be decided, strongest first.
 *
 * A list rather than a run of branches, because the order *is* the rule and this
 * is the only spelling where the order can be read off the page. Each way
 * answers with an outcome it will stand behind, or with nothing, which means the
 * next way is asked; when all of them pass, nothing serves the address.
 */
const WAYS: ReadonlyArray<(ask: Ask) => UiOutcome | undefined> = [
  byAnnotation,
  byApiTarget,
  byBaseUrlEnv,
  byBaseUrlValue,
  byHost,
  byProxy,
  byIngress,
  bySameService,
  byUniqueRoute,
];


/** An address whose opening was not read and whose rest was: `/${…}/settings`. */
const UNREAD_BASE = /^\/\$\{…\}((?:\/[^/]+)+)$/;

/**
 * A GraphQL operation sent under a base nothing read (P266).
 *
 * `${SERVER_URL}/settings`, where the server's address is decided where the
 * page is served, is a request the address alone cannot join. What it sends
 * says more: it is an operation, and only a GraphQL endpoint answers one. So
 * the read rest of the address is asked of every endpoint of every service -
 * of the one its settings key names, where it names one - and the one whose
 * path ends with it answers; two are a row naming both, and none leaves the
 * address partly read. Never a route that is not an endpoint, and never an
 * address with a hole after its opening.
 */
const byGraphqlPath = (call: GraphNode, path: string, index: UiIndex): UiOutcome | undefined => {
  // An operation: one whose document was read, or one a GraphQL client sends whatever its document.
  const operation = sendsOperation(call);
  if (!operation || call.meta?.['method'] !== 'POST') return undefined;
  const tail = UNREAD_BASE.exec(path)?.[1];
  if (tail === undefined || !wasRead(tail)) return undefined;
  const env = call.meta?.['baseUrlEnv'];
  const named = typeof env === 'string' ? index.targetOf(call.repo, env) : undefined;
  const services = named === undefined ? index.services() : [named];
  const found = services.flatMap((service) =>
    (index.routesOf(service) ?? [])
      .filter((route) => {
        const served = route.meta?.['graphql'] as { endpoint?: boolean } | undefined;
        const at = route.meta?.['path'];
        return served?.endpoint === true && route.meta?.['method'] === 'POST' && typeof at === 'string' && (at === tail || at.endsWith(tail));
      })
      .map((entry) => ({ service, entry })),
  );
  const [only] = found;
  if (found.length === 1 && only !== undefined) return { kind: 'linked', via: 'graphql-path', entry: only.entry, targetService: only.service, runnersUp: [] };
  if (found.length > 1) return { kind: 'ambiguous', method: 'POST', path, candidates: found.map(({ service, entry }) => `${service} at ${String(entry.meta?.['path'])}`).sort(cmp) };
  return undefined;
};

/**
 * A request read in part that a catch-all answers whatever the unread part
 * holds (P279): of the caller's own service where the address names no host
 * and no setting, as a relative address means; of the one service its
 * setting names otherwise. See {@link catchAllBehind}.
 */
const byCatchAll = (call: GraphNode, method: unknown, path: string, env: unknown, index: UiIndex): UiOutcome | undefined => {
  if (typeof method !== 'string' || typeof call.meta?.['host'] === 'string') return undefined;
  const service = typeof env === 'string' ? index.targetOf(call.repo, env) : call.repo;
  if (service === undefined) return undefined;
  const from = service === call.repo ? callingApplication(call) : undefined;
  const entry = catchAllBehind(method, path, index.routesOf(service) ?? [], from);
  if (entry === undefined) return undefined;
  return { kind: 'linked', via: typeof env === 'string' ? 'base-url-env' : 'same-service', entry, targetService: service, runnersUp: [] };
};

/**
 * Decides which route a request made in the browser reaches.
 *
 * Answers a question and changes nothing, so the decision can be read, tested
 * and reported on separately from what is done about it.
 */
export const resolveUiCall = (call: GraphNode, index: UiIndex): UiOutcome => {
  const method = call.meta?.['method'];
  const path = call.meta?.['path'];
  const env = call.meta?.['baseUrlEnv'];

  if (typeof path !== 'string') return { kind: 'dynamic', reason: 'api-path-dynamic' };
  // Part of the address was read and part was not. Matching the readable part
  // and letting a route's own hole cover the rest is how a request nobody could
  // follow became an edge marked `static`. It is counted apart from an address
  // that was wholly unreadable, because this one is often a helper the tool
  // could learn to follow, and that is worth being able to measure.
  if (!wasRead(path)) return byGraphqlPath(call, path, index) ?? byCatchAll(call, method, path, env, index) ?? { kind: 'dynamic', reason: 'api-path-partly-read' };
  if (typeof method !== 'string') return { kind: 'dynamic', reason: 'api-method-dynamic' };

  const ask: Ask = { call, method, path, env: typeof env === 'string' ? env : undefined, index };
  for (const way of WAYS) {
    const found = way(ask);
    if (found !== undefined) return found;
  }

  // Nothing serves it. The verbs come from the caller's own service, which is
  // the only service here that certainly exists and is now the likeliest place
  // the address was meant for, so "that path answers GET" is a sentence worth
  // having beside a request written as a POST.
  return {
    kind: 'noRoute',
    targetService: null,
    method,
    path,
    verbs: verbsAnswering(path, index.routesOf(call.repo) ?? []),
    unread: index.services().flatMap((service) => behindUnread(method, path, index.routesOf(service) ?? [])),
  };
};

/**
 * A caller may leave out a prefix the service adds to all of its routes.
 *
 * A browser is given a base address that already ends in the prefix, so the
 * path it writes is the path without it. The same retry the service-to-service
 * linker makes, for the same reason.
 *
 * There is deliberately no mirror of this — no retry for a prefix the *route* is
 * missing and the request carries. It was the cheaper of the two answers to
 * R114 and it is the wrong one. This retry is gated on the routes themselves
 * declaring the prefix, so it forgives a caller for something the service wrote
 * down; the mirror has nothing to be gated on, because a route missing a segment
 * says nothing about the segment it is missing. It would have joined
 * `/api/passkeys.list` to `/passkeys.list` on the measured repository — which is
 * right there, and wrong for the reason that matters: those routes are mounted by
 * a registry this tool does not follow, so their recorded address is genuinely
 * incomplete, and forgiving it here would hide a reader's gap behind a join and
 * make the same string match routes in services that have no such prefix at all.
 * The answer taken instead was to record the client's own base in the address, so
 * both ends carry the segment and this only ever has one string to compare.
 */
const withGlobalPrefix = (path: string, routes: readonly GraphNode[]): string | undefined => {
  const prefix = routes
    .map((route) => route.meta?.['globalPrefix'])
    .find((value) => typeof value === 'string');
  return typeof prefix === 'string' ? `/${prefix}/${path}`.replace(/\/+/g, '/') : undefined;
};

/**
 * The application the caller is written in, where that says anything about the
 * service being asked.
 *
 * Only where the service asked is the caller's own. An application is named by
 * where it sits in a repository, so `examples/blog` names an address space of
 * this service and nothing at all of another one; handing the name across a
 * service boundary would match a route by a coincidence of directory names.
 */
const callerApplicationIn = (ask: Ask, service: string): string | undefined =>
  service === ask.call.repo ? callingApplication(ask.call) : undefined;

/** The route one named service answers with, or why it does not. */
const within = (ask: Ask, targetService: string, via: UiVia): UiOutcome => {
  const { method, path, index } = ask;
  const routes = index.routesOf(targetService) ?? [];
  const from = callerApplicationIn(ask, targetService);
  let found = matchRoute(method, path, routes, from);
  if (!isMatch(found) && found.reason === 'not-found') {
    const prefixed = withGlobalPrefix(path, routes);
    if (prefixed !== undefined) found = matchRoute(method, prefixed, routes, from);
  }
  if (isMatch(found)) {
    return {
      kind: 'linked',
      via,
      entry: found.entry,
      targetService,
      runnersUp: found.runnersUp ?? [],
      ...(found.mountAssumed === undefined ? {} : { mountAssumed: found.mountAssumed }),
    };
  }
  if (found.reason === 'ambiguous') {
    return {
      kind: 'ambiguous',
      method,
      path,
      candidates: found.candidates,
      ...(found.applications === undefined ? {} : { applications: found.applications }),
    };
  }
  return {
    kind: 'noRoute',
    targetService,
    method,
    path,
    verbs: verbsAnswering(path, routes),
    unread: behindUnread(method, path, routes),
  };
};
