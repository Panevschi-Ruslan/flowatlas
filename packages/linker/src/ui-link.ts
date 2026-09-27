import { UNREAD_SPAN, wasRead, type GraphNode } from '@flowatlas/core';
import type { Finding } from './http-link.js';
import { cmp } from './order.js';
import {
  callingApplication,
  isMatch,
  matchRoute,
  pathAnswers,
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
}

/**
 * How the service on the other end was decided.
 *
 * `same-service` is the browser asking the server it was served from, which is
 * what a relative address means and by far the commonest shape there is. It
 * ranks with the two configured answers rather than with the guess: a path that
 * matches a route in the very repository the call was written in is evidence
 * from one reading of one directory, and nothing about it is a guess (R93).
 */
export type UiVia = 'api-target' | 'base-url-env' | 'same-service' | 'unique-route';

/** What each way a request can end carries with it. */
interface Details {
  linked: {
    via: UiVia;
    entry: GraphNode;
    targetService: string;
    runnersUp: readonly string[];
  };
  /** The address or the verb is only known at run time; the extractor said so. */
  dynamic: { reason: string };
  /** No route answers. `targetService` is null when nothing named one to ask. */
  noRoute: {
    targetService: string | null;
    method: string;
    path: string;
    verbs: readonly string[];
    /**
     * Routes that would answer if the part of their own address nobody read
     * were left open, as `service METHOD path`. Never a join: see
     * {@link behindUnread}.
     */
    unread: readonly string[];
  };
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

/** How many of the routes behind an unread part a row names before it counts the rest. */
const UNREAD_NAMED = 3;

/**
 * A request that no route read in full answers, beside a route that may be it.
 *
 * Not the sentence above, because that one would be false. On novu every one of
 * its 456 addresses begins with a mount the deployment sets, `${CONTEXT_PATH}v`,
 * so each was recorded as `/${…}v1/…`; the command-line client writes `/v1/agents`
 * under a base that already carries the mount, and for forty-two such requests
 * the report said no configured service serves an address the graph holds with a
 * hole in front of it. The reason is unchanged, because the request still reaches
 * no route; what changes is that the row names the route and the part of it that
 * was not read, which is where the fix is.
 */
const unreadRoute = ({ targetService, method, path, unread }: Details['noRoute']): Finding => {
  const named = unread.slice(0, UNREAD_NAMED).join(', ');
  const more = unread.length > UNREAD_NAMED ? ` and ${unread.length - UNREAD_NAMED} more` : '';
  const one = unread.length === 1;
  return {
    reason: 'target-route-not-found',
    message:
      `${targetService === null ? 'no configured service serves' : `target service ${targetService} has no route`} ` +
      `${method} ${path} at an address read in full, though ${named}${more} ${one ? 'answers' : 'answer'} it ` +
      `if the part of ${one ? 'its' : 'their'} address nobody read is left open`,
    hint:
      'This is not evidence that the route is missing. Part of the route’s address could not be read — ' +
      'a prefix or a version assembled from a setting, usually, with a row of its own where it is built — ' +
      'and until that part is read no request can be joined to it.',
  };
};

/**
 * What each outcome means to whoever reads the report.
 *
 * A table rather than a chain of branches: adding a way for a request to end
 * means adding a row here and a row in `Details`, and nothing else changes.
 */
const FINDINGS: { [K in UiOutcomeKind]: ((detail: Details[K]) => Finding) | null } = {
  linked: null,
  dynamic: null,
  noRoute: (detail) => (detail.unread.length === 0 ? missingRoute(detail) : unreadRoute(detail)),
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

/** Which verbs a path does answer, for when only the verb was wrong. */
const verbsAnswering = (path: string, routes: readonly GraphNode[]): string[] =>
  [
    ...new Set(
      routes
        .filter((route) => pathAnswers(String(route.meta?.['path'] ?? ''), path))
        .map((route) => String(route.meta?.['method'] ?? '')),
    ),
  ].sort(cmp);

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
 * The service the call was written in, answering its own browser.
 *
 * This is what a relative `fetch('/api/thing')` means, and until R93 it was the
 * one service excluded from the question. Nothing names a service in such a
 * call, so neither of the two ways above fires and this is the only reading
 * available — no line of configuration could have supplied one. On cal.com that
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
  byApiTarget,
  byBaseUrlEnv,
  bySameService,
  byUniqueRoute,
];

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
  if (!wasRead(path)) return { kind: 'dynamic', reason: 'api-path-partly-read' };
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
 * A route's address as a pattern that leaves the part nobody read open.
 *
 * Each `${…}` may stand for any text, separators included, because that is what
 * the marker means; a declared `:param` stands for one segment, as it does in a
 * match. Case is ignored for the reason `pathAnswers` gives.
 */
const openShapeOf = (routePath: string): RegExp => {
  const read = routePath.split(UNREAD_SPAN).map((piece) =>
    piece
      .split('/')
      .map((segment) => (segment === ':param' ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/'),
  );
  return new RegExp(`^${read.join('.*')}$`, 'i');
};

/** Whether what was read of an address says anything: one literal segment, at least. */
const saysSomething = (routePath: string): boolean =>
  routePath
    .split(UNREAD_SPAN)
    .join('/')
    .split('/')
    .some((segment) => segment !== '' && segment !== ':param');

/**
 * Routes that would answer this request if the part of their address nobody
 * read were left open.
 *
 * Used for a sentence and never for an edge. Joining here is the prefix-tolerant
 * retry R114 declined (see {@link withGlobalPrefix}): a hole may stand for
 * anything, so a match through one is a possibility and not a fact, and an edge
 * claims a fact. What it does settle is that "nothing serves this" is not known
 * either, and a row saying so is the most confident false thing the report can
 * print. A route of which nothing but the hole was read is left out, because it
 * would be named beside every request there is.
 */
const behindUnread = (method: string, path: string, routes: readonly GraphNode[]): string[] => {
  const wanted = method.toUpperCase();
  return routes
    .filter((route) => {
      const routePath = String(route.meta?.['path'] ?? '');
      const declared = String(route.meta?.['method'] ?? '').toUpperCase();
      return (
        !wasRead(routePath) &&
        saysSomething(routePath) &&
        (declared === 'ALL' || declared === wanted) &&
        openShapeOf(routePath).test(path)
      );
    })
    .map((route) => `${route.repo} ${String(route.meta?.['method'] ?? '')} ${String(route.meta?.['path'])}`)
    .sort(cmp);
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
