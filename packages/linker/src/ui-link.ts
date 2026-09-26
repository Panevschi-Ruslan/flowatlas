import { wasRead, type GraphNode } from '@flowatlas/core';
import type { Finding } from './http-link.js';
import { cmp } from './order.js';
import { isMatch, matchRoute, pathAnswers } from './route-match.js';

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
  };
  /** More than one service answers, and nothing says which one is meant. */
  ambiguous: { method: string; path: string; candidates: readonly string[] };
}

export type UiOutcomeKind = keyof Details;

export type UiOutcome = { [K in UiOutcomeKind]: { kind: K } & Details[K] }[UiOutcomeKind];

/**
 * What each outcome means to whoever reads the report.
 *
 * A table rather than a chain of branches: adding a way for a request to end
 * means adding a row here and a row in `Details`, and nothing else changes.
 */
const FINDINGS: { [K in UiOutcomeKind]: ((detail: Details[K]) => Finding) | null } = {
  linked: null,
  dynamic: null,
  noRoute: ({ targetService, method, path, verbs }) => ({
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
  }),
  ambiguous: ({ method, path, candidates }) => ({
    reason: 'ambiguous-route-target',
    message: `${candidates.join(' and ')} both answer ${method} ${path}`,
    hint: 'Set services[].apiTarget on the frontend to say which service its settings key names.',
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
const byApiTarget = ({ call, method, path, env, index }: Ask): UiOutcome | undefined => {
  const named = env === undefined ? undefined : index.targetOf(call.repo, env);
  // Terminal once a target is named, wrong answer included: somebody wrote down
  // which service that key means, and a search behind their back would only
  // hide the fact that the route they named is gone.
  return named === undefined ? undefined : within(named, 'api-target', method, path, index);
};

/** Exactly one service declaring the same settings key as its own base. */
const byBaseUrlEnv = ({ method, path, env, index }: Ask): UiOutcome | undefined => {
  if (env === undefined) return undefined;
  const claiming = index.claimantsOf(env);
  return claiming.length === 1
    ? within(claiming[0] as string, 'base-url-env', method, path, index)
    : undefined;
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
const bySameService = ({ call, method, path, index }: Ask): UiOutcome | undefined => {
  const own = within(call.repo, 'same-service', method, path, index);
  return own.kind === 'noRoute' ? undefined : own;
};

/**
 * Whoever happens to serve that route, when nothing said who should.
 *
 * A guess, and it comes back as one: the same address may be served by two
 * services for entirely different callers, so one candidate is a usable guess
 * and several is a question only the configuration can settle.
 */
const byUniqueRoute = ({ method, path, index }: Ask): UiOutcome | undefined => {
  const answering = index
    .services()
    .filter((service) => {
      const routes = index.routesOf(service) ?? [];
      if (isMatch(matchRoute(method, path, routes))) return true;
      const prefixed = withGlobalPrefix(path, routes);
      return prefixed !== undefined && isMatch(matchRoute(method, prefixed, routes));
    })
    .sort(cmp);

  if (answering.length === 1) {
    return within(answering[0] as string, 'unique-route', method, path, index);
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
  };
};

/**
 * A caller may leave out a prefix the service adds to all of its routes.
 *
 * A browser is given a base address that already ends in the prefix, so the
 * path it writes is the path without it. The same retry the service-to-service
 * linker makes, for the same reason.
 */
const withGlobalPrefix = (path: string, routes: readonly GraphNode[]): string | undefined => {
  const prefix = routes
    .map((route) => route.meta?.['globalPrefix'])
    .find((value) => typeof value === 'string');
  return typeof prefix === 'string' ? `/${prefix}/${path}`.replace(/\/+/g, '/') : undefined;
};

/** The route one named service answers with, or why it does not. */
const within = (
  targetService: string,
  via: UiVia,
  method: string,
  path: string,
  index: UiIndex,
): UiOutcome => {
  const routes = index.routesOf(targetService) ?? [];
  let found = matchRoute(method, path, routes);
  if (!isMatch(found) && found.reason === 'not-found') {
    const prefixed = withGlobalPrefix(path, routes);
    if (prefixed !== undefined) found = matchRoute(method, prefixed, routes);
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
    return { kind: 'ambiguous', method, path, candidates: found.candidates };
  }
  return {
    kind: 'noRoute',
    targetService,
    method,
    path,
    verbs: verbsAnswering(path, routes),
  };
};
