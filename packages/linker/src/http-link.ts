import { normalizePath, wasRead, type GraphNode } from '@flowatlas/core';
import {
  behindUnread,
  callingApplication,
  isMatch,
  matchRoute,
  verbsAnswering,
  type RouteResult,
} from './route-match.js';
import { chooseByApiName } from './api-choice.js';
import { whereFound, type BaseUrlAnswer, type FoundValue } from './base-url-value.js';

/** A reason, a sentence and what to do about it — everything but where it happened. */
export interface Finding {
  reason: string;
  message: string;
  hint: string;
  /** Set only where the row is worth reading and asks nothing of anybody. */
  level?: 'info';
}

/** The annotation that says where a call goes, when the calling method carries one. */
export interface CallsServiceMarker {
  service: string;
  method: string;
  path: string;
}

/**
 * What the linker can be asked about the project while resolving one call.
 *
 * Passed in rather than reached for, so resolving a call is a question about
 * these three lookups and nothing else, and can be asked in a test without a
 * project behind it.
 */
export interface RouteIndex {
  /** Routes a service serves, named by its name or an alias. Empty when it serves none, undefined when unknown. */
  routesOf(service: string): readonly GraphNode[] | undefined;
  /** The service a name or an alias names (P91); undefined for a name no service answers to. */
  serviceOf?(name: string): string | undefined;
  /** Every alias configured, for the row about a name no service answers to. */
  aliases?(): readonly string[];
  /** Services declaring a settings key. More than one means the key names none. */
  claimantsOf(env: string): readonly string[];
  /** The annotation on the method that makes this call, if it carries one. */
  markerOf(callId: string): CallsServiceMarker | undefined;
  /**
   * Every such annotation, when the method carries more than one.
   *
   * A method that sends one request to each of several services in a loop has
   * one call site and several targets, and says so with one annotation each.
   */
  markersOf?(callId: string): CallsServiceMarker[];
  /**
   * The function URLs a request rooted at a setting reaches, through the
   * functions that run it and are deployed with that setting (P54).
   */
  functionUrlsOf?(callId: string): readonly GraphNode[];
  /**
   * What the values a request's setting is given say its base address is,
   * where no service claims the setting (P77).
   */
  baseUrlOf?(call: GraphNode): BaseUrlAnswer | undefined;
  /**
   * The service a request through a worker's binding reaches (P91), from the
   * bindings the caller's deployment declares and the names services are
   * known by.
   */
  bindingOf?(call: GraphNode, binding: string): BindingAnswer;
}

/** Where a binding goes, as the deployment files and the configuration say. */
export type BindingAnswer =
  | { readonly kind: 'service'; readonly service: string; readonly workers: readonly string[] }
  /** Declared, to workers no service is named or aliased as, or that name more than one. */
  | { readonly kind: 'unknown'; readonly workers: readonly string[]; readonly services: readonly string[] }
  /** No deployment file of the caller declares it. */
  | { readonly kind: 'undeclared' };

/** What each way a call can end carries with it. */
interface Details {
  linked: {
    via: 'baseUrlEnv' | 'marker' | 'functionUrl' | 'apiName' | 'baseUrlValue' | 'serviceBinding';
    entry: GraphNode;
    runnersUp: readonly string[];
    /** The settings whose part of the route's address was taken as empty (R144). */
    mountAssumed?: readonly string[];
  };
  /** The host, when it was found from the value the setting is given rather than written in the call (P77). */
  external: { host?: string };
  /** The service is known when the address said so; the route never was. */
  dynamic: { targetService?: string };
  unknownEnv: {
    env: string;
    claiming: readonly string[];
    /** What the setting's values said, where they settled nothing (P77). */
    values?: Extract<BaseUrlAnswer, { kind: 'unsettled' }>;
  };
  /** A request through a binding no configured service can be found behind (P91). */
  unknownBinding: {
    binding: string;
    /** The workers the deployment binds it to; empty when nothing declares it. */
    workers: readonly string[];
    /** The services those workers name, when they name more than one. */
    services: readonly string[];
  };
  noRoute: {
    targetService: string;
    method: string;
    path: string;
    verbs: readonly string[];
    /**
     * Routes that would answer if the part of their own address nobody read
     * were left open, as `service METHOD path`. Never a join.
     */
    unread: readonly string[];
  };
  ambiguous: {
    targetService: string;
    method: string;
    path: string;
    candidates: readonly string[];
    /** The applications answering, when the candidates are not all in one. */
    applications?: readonly string[];
    /** The APIs answering, when the candidates are one route per API and the setting's name chose none (P59). */
    apis?: readonly string[];
  };
}

export type OutcomeKind = keyof Details;

export type CallOutcome = { [K in OutcomeKind]: { kind: K } & Details[K] }[OutcomeKind];

export interface Resolution {
  outcome: CallOutcome;
  /** Further routes the call reaches, named by further annotations on its method. */
  alsoLinked?: Array<{ entry: GraphNode; mountAssumed?: readonly string[] }>;
  /** Findings that did not decide the outcome, such as an annotation that missed. */
  notes: Finding[];
  /** The value the base address was taken from, where a setting's value decided it (P77). */
  baseUrl?: FoundValue;
}

/**
 * What each outcome means to whoever reads the report.
 *
 * A table rather than a chain of branches: adding a way for a call to end means
 * adding a row here and a row in `Details`, and nothing else changes.
 */
const FINDINGS: { [K in OutcomeKind]: ((detail: Details[K]) => Finding) | null } = {
  linked: null,
  external: null,
  dynamic: null,
  unknownEnv: ({ env, claiming, values }) =>
    claiming.length === 0 && values !== undefined
      ? unsettledFinding(env, values)
      : {
          reason: 'unknown-base-url-env',
          message:
            claiming.length === 0
              ? `no service declares ${env}`
              : `${env} is declared on services ${claiming.join(' and ')}`,
          hint:
            claiming.length === 0
              ? `Add ${env} to services[].baseUrlEnv of whichever service answers it.`
              : `Leave ${env} on the one service that answers it.`,
        },
  unknownBinding: ({ binding, workers, services }) => ({
    reason: 'service-binding-unknown',
    message:
      workers.length === 0
        ? `the request goes through the binding ${binding}, which no deployment file of this service declares`
        : services.length > 1
          ? `${binding} is bound to ${workers.join(' and ')}, which name ${services.join(' and ')}, not one service`
          : `${binding} is bound to ${workers.join(' and ')}, which no configured service is named or aliased as`,
    hint:
      workers.length === 0
        ? `Declare ${binding} under services in the worker's wrangler file, or add the service it reaches to the configuration.`
        : `Add ${workers[0] ?? 'the worker'} to services[].aliases of the service it is, or add that service to the configuration.`,
  }),
  noRoute: (detail) =>
    detail.unread.length === 0
      ? {
          reason: 'target-route-not-found',
          message: `target service ${detail.targetService} has no route ${detail.method} ${detail.path}`,
          hint:
            `${detail.verbs.length === 0 ? '' : `That path answers ${detail.verbs.join(', ')}. `}` +
            `Route renamed? Check ${detail.targetService}'s controllers, or annotate the call with @CallsService.`,
        }
      : unreadRouteFinding(detail),
  ambiguous: (detail) =>
    AMBIGUITY[detail.apis !== undefined ? 'api' : detail.applications === undefined ? 'route' : 'application'](detail),
};

/** How many of a setting's values a row names before it counts the rest. */
const VALUES_NAMED = 3;

/**
 * What is said of a setting no service claims whose values were found and
 * settled nothing (P77): which values, where, and why each is not a service.
 */
const unsettledFinding = (env: string, answer: Extract<BaseUrlAnswer, { kind: 'unsettled' }>): Finding => {
  const named = answer.values.slice(0, VALUES_NAMED).map((found) => `${found.value} in ${whereFound(found)}`);
  const more = answer.values.length > VALUES_NAMED ? ` and ${answer.values.length - VALUES_NAMED} more` : '';
  const values = named.length === 0 ? '' : `; its value is ${named.join(', ')}${more}`;
  const why =
    answer.services.length > 1
      ? `, which name ${answer.services.join(' and ')}, not one service`
      : named.length === 0
        ? ''
        : `, and no configured service is reached at ${answer.values.length === 1 ? 'that host' : 'those hosts'}`;
  const unread =
    answer.namedOnly.length === 0
      ? ''
      : `${named.length === 0 ? '; it' : '. It'} is set in ${answer.namedOnly.join(', ')}, whose values are never read`;
  return {
    reason: 'unknown-base-url-env',
    message: `no service declares ${env}${values}${why}${unread}`,
    hint:
      answer.services.length > 1
        ? `Choose the environment to read under settingFiles.environment, or add ${env} to services[].baseUrlEnv of the service that answers it.`
        : `Add ${env} to services[].baseUrlEnv of whichever service answers it, or the host to its services[].hosts.`,
  };
};

/**
 * What is said beside a request whose base address was taken from the value
 * its setting is given (P77). `info`: nothing is wrong; the row is there so
 * the join is never mistaken for one the configuration made.
 */
export const baseUrlTakenFinding = (found: FoundValue, target: string): Finding =>
  found.byName === true
    ? {
        reason: 'base-url-from-name',
        level: 'info',
        message:
          `no service declares ${found.variable} and ` +
          `${found.unmatched === undefined ? 'nothing read gives it a value' : `no configured service is reached at ${found.unmatched.join(', ')}`}` +
          `${found.namedOnly === undefined ? '' : ` (it is set in ${found.namedOnly.join(', ')}, whose values are never read)`}` +
          `, so it is taken as ${target}, the one service it is named after`,
        hint: `Only the setting's name chose the service. Add ${found.variable} to services[].baseUrlEnv of ${target} to say so outright, or of the service it really is.`,
      }
    : {
        reason: 'base-url-from-files',
        level: 'info',
        message: `${found.variable} is ${found.value} in ${whereFound(found)}, which is taken as ${target}`,
        hint: found.deployed
          ? 'The value is the one the function is deployed with.'
          : `The value is one the repository writes down for running it, not necessarily the deployed one. Add ${found.variable} to services[].baseUrlEnv of ${target} to say so outright.`,
      };

/**
 * Two ways one request can answer to more than one entry, which are not one way.
 *
 * Two routes of one application tying is a defect in that application: whichever
 * was registered first answers and the other is dead code that still type-checks,
 * and the fix is to delete a route. Two *applications* of one service both
 * serving the address is a defect in nothing — a worker and an API each answer on
 * their own port — and what cannot be known is only which of them this caller
 * reaches, because that is decided by deployment and written in no source. The
 * rows say so separately, since a reader told to make a path more specific when
 * nothing is wrong with the path spends the afternoon on it.
 */
const AMBIGUITY: Record<
  'route' | 'application' | 'api',
  (detail: Details['ambiguous']) => Finding
> = {
  // Two APIs of one deployment serving one address is a defect in nothing
  // either; which one a caller reaches is the base URL it is given, and the
  // setting's name did not say (P59).
  api: ({ targetService, method, path, apis = [] }) => ({
    reason: 'ambiguous-route-api',
    message: `${apis.length} APIs in ${targetService} serve ${method} ${path}: ${apis.join(', ')}`,
    hint: 'Which one the call reaches is the base URL it is given. Name the setting after the API (BILLING_API_URL for billing-api), or annotate the call with @CallsService.',
  }),
  route: ({ targetService, method, path, candidates }) => ({
    reason: 'ambiguous-route',
    message: `more than one route in ${targetService} answers ${method} ${path}`,
    hint: `Candidates: ${candidates.join(', ')}. Make the path more specific, or annotate the call with @CallsService.`,
  }),
  application: ({ targetService, method, path, applications = [] }) => ({
    reason: 'ambiguous-route-application',
    message: `${applications.length} applications in ${targetService} serve ${method} ${path}: ${applications.join(', ')}`,
    // Deliberately suggests nothing. @CallsService names a service, a verb and a
    // path, and has no room for an application, so telling a reader to annotate
    // the call would send them to write an annotation that resolves to the same
    // two candidates. The row exists to be read, not acted on.
    hint: `Nothing is wrong with the route, and nothing here can choose between them: which of ${applications.join(' and ')} answers a request from outside is decided by how they are deployed, and no source says. Both are named above rather than one of them guessed at.`,
  }),
};

/** How many of the routes behind an unread part a row names before it counts the rest. */
const UNREAD_NAMED = 3;

/**
 * A request that no route read in full answers, beside a route that may be it.
 *
 * Not the plain sentence, because that one would be false. On a notification service every one of
 * its 456 addresses begins with a mount the deployment sets, `${CONTEXT_PATH}v`,
 * so each was recorded as `/${…}v1/…`, and a request for `/v1/agents` was
 * reported as asking for something nobody serves about an address the graph
 * holds with a hole in front of it. The reason is unchanged, because the request
 * still reaches no route; what changes is that the row names the route and the
 * part of it that was not read, which is where the fix is.
 *
 * Said the same way whichever linker reached it: R137 corrected the browser's
 * sentence and left the one between services saying the old thing (R144).
 */
export const unreadRouteFinding = ({
  targetService,
  method,
  path,
  unread,
}: {
  targetService: string | null;
  method: string;
  path: string;
  unread: readonly string[];
}): Finding => {
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
 * What is said beside a join that rests on a mount taken as empty (R144).
 *
 * One row per request joined that way, because the assumption is made for each
 * one and each is an edge a reader will meet on its own. `info`: nothing is
 * wrong, and nothing is asked of anybody — the row is there so that a join
 * weaker than one read in full never looks like one.
 */
export const mountAssumedFinding = (
  method: string,
  path: string,
  entry: GraphNode,
  settings: readonly string[],
): Finding => {
  const route = `${String(entry.meta?.['method'] ?? '?')} ${String(entry.meta?.['path'] ?? '?')}`;
  const named =
    settings.length <= 2
      ? settings.join(' and ')
      : `${settings.slice(0, -1).join(', ')} and ${settings[settings.length - 1] ?? ''}`;
  return {
    reason: 'route-mount-assumed-empty',
    level: 'info',
    message:
      `${method} ${path} is joined to ${entry.repo} ${route} by taking the part of its address read from ` +
      `${named} as empty, as every committed environment file of ${entry.repo} leaves ${settings.length === 1 ? 'it' : 'them'}`,
    hint:
      `The part is where a deployment mounts the service. One that sets ${named} serves every route behind it, ` +
      'and this join is then wrong, so it is weaker than a join read in full.',
  };
};

/**
 * What is said beside a join to one of several APIs serving one address,
 * chosen by the name of the setting the base URL is read from (P59). `info`:
 * the join is a guess and is drawn as one.
 */
export const apiGuessedFinding = (
  method: string,
  path: string,
  setting: string,
  api: string,
  apis: readonly string[],
): Finding => ({
  reason: 'route-api-guessed',
  level: 'info',
  message: `${method} ${path} is served by ${apis.join(', ')}; ${api} is taken because the call's base URL is read from ${setting}`,
  hint: 'Only the name of the setting chose the API. Annotate the call with @CallsService where that is wrong.',
});

/** The finding an outcome carries, or nothing when the call resolved cleanly. */
export const findingFor = (outcome: CallOutcome): Finding | undefined => {
  const describe = FINDINGS[outcome.kind] as ((detail: CallOutcome) => Finding) | null;
  return describe === null ? undefined : describe(outcome);
};

/** The same table for the two ways an annotation can be wrong. */
const MARKER_FINDINGS = {
  serviceUnknown: (marker: CallsServiceMarker, aliases: readonly string[] = []): Finding => ({
    reason: 'marker-service-unknown',
    message:
      `@CallsService names ${marker.service}, which is not a configured service` +
      (aliases.length === 0 ? '' : ` nor an alias of one (the aliases are ${aliases.join(', ')})`),
    hint: `Add ${marker.service} to services[] in flowatlas.config.json, or to services[].aliases of the service it means, or correct the annotation.`,
  }),
  routeNotFound: (marker: CallsServiceMarker): Finding => ({
    reason: 'marker-route-not-found',
    message: `@CallsService points at ${marker.method} ${marker.path}, which ${marker.service} does not serve`,
    hint: `Check ${marker.service}'s controllers, or correct the annotation.`,
  }),
};

/** The API a name points at among the routes a request is ambiguous between. */
const chooseAmong = (routes: readonly GraphNode[], candidates: readonly string[], name: string) =>
  chooseByApiName(
    routes.filter((route) => candidates.includes(route.id)),
    name,
  );

/** A caller may leave out a prefix the service adds to all of its routes. */
const withGlobalPrefix = (path: string, routes: readonly GraphNode[]): string | undefined => {
  const prefix = routes
    .map((route) => route.meta?.['globalPrefix'])
    .find((value) => typeof value === 'string');
  return typeof prefix === 'string' ? `/${prefix}/${path}`.replace(/\/+/g, '/') : undefined;
};

/**
 * Decides where one outgoing request goes.
 *
 * Answers a question and changes nothing: no edge is drawn and no count is
 * moved here, so the decision can be read, tested and reported on separately
 * from what is done about it.
 *
 * An annotation is asked first and wins outright, because it exists precisely
 * for the calls static reading cannot follow. An annotation that misses is a
 * note rather than an answer: the settings key is still tried, so a stale
 * annotation degrades to what the tool could work out on its own.
 */
export const resolveCall = (call: GraphNode, index: RouteIndex): Resolution => {
  const notes: Finding[] = [];
  /**
   * The application the caller is written in, where the service asked is the
   * caller's own.
   *
   * The same rule the browser linker applies, written here too so the two
   * cannot develop different opinions about when a caller's own application
   * decides a tie (R132). A server request records it wherever the service's
   * applications are directories (R136); where they are declarations it is
   * absent and nothing below changes. A call that crosses a service boundary is
   * outside every application of the service it reaches and is absent
   * regardless.
   */
  const callerApplicationIn = (service: string): string | undefined =>
    service === call.repo ? callingApplication(call) : undefined;
  // A verb a caller hands in that nothing could read is `null` (P91), and a
  // request whose verb is not known matches no route: its address may be
  // read in full and the route it reaches is still any of the ones there.
  const stated = call.meta?.['method'];
  const verbRead = stated !== null;
  const method = typeof stated === 'string' ? stated : 'GET';
  const path = call.meta?.['path'];
  const env = call.meta?.['baseUrlEnv'];
  const host = call.meta?.['host'];

  /**
   * The route a service answers this request with, once the service is
   * known, however it was found: a setting, a value, a binding (P91).
   */
  const within = (
    targetService: string,
    via: Extract<CallOutcome, { kind: 'linked' }>['via'],
    taken: { baseUrl?: FoundValue },
    requestedPath: unknown = path,
  ): Resolution => {
    // Knowing which service is asked is not knowing what is asked of it. A route
    // guessed here would be a route this service does not serve, reported as
    // drift that does not exist.
    //
    // A path read in part is not a path read. `/orders/${…}/items` would once
    // have matched `/orders/:param/items` and produced an edge marked `static`
    // towards a route this call may never reach.
    // An empty path is a request for exactly what a setting holds, which is
    // only an address once the setting's value says what is in it (P91).
    if (typeof requestedPath !== 'string' || requestedPath === '' || !wasRead(requestedPath) || !verbRead) {
      return { outcome: { kind: 'dynamic', targetService }, notes, ...taken };
    }

    const routes = index.routesOf(targetService) ?? [];
    const requested = requestedPath as string;
    const from = callerApplicationIn(targetService);
    let found = matchRoute(method, requested, routes, from);
    if (!isMatch(found) && found.reason === 'not-found') {
      const prefixed = withGlobalPrefix(requested, routes);
      if (prefixed !== undefined) found = matchRoute(method, prefixed, routes, from);
    }

    if (isMatch(found)) {
      return { outcome: { kind: 'linked', via, ...joined(method, requested, found) }, notes, ...taken };
    }
    if (found.reason === 'ambiguous') {
      const setting = typeof env === 'string' ? env : targetService;
      const choice = chooseAmong(routes, found.candidates, setting);
      if (choice.kind === 'one') {
        notes.push(apiGuessedFinding(method, requested, setting, choice.api, choice.apis));
        return { outcome: { kind: 'linked', via: 'apiName', entry: choice.entry, runnersUp: [] }, notes, ...taken };
      }
      return {
        outcome: {
          kind: 'ambiguous',
          targetService,
          method,
          path: requested,
          candidates: choice.kind === 'narrowed' ? choice.entries.map((entry) => entry.id) : found.candidates,
          ...(found.applications === undefined ? {} : { applications: found.applications }),
          ...(choice.kind === 'tie' ? { apis: choice.apis } : {}),
        },
        notes,
        ...taken,
      };
    }
    return {
      outcome: {
        kind: 'noRoute',
        targetService,
        method,
        path: requested,
        verbs: verbsAnswering(requested, routes),
        unread: behindUnread(method, requested, routes),
      },
      notes,
      ...taken,
    };
  };

  const single = index.markerOf(call.id);
  const markers = index.markersOf?.(call.id) ?? (single === undefined ? [] : [single]);
  const reached: Array<{ entry: GraphNode; runnersUp: readonly string[]; mountAssumed?: readonly string[]; guessed?: true }> = [];
  /** A match, with the row a join across a mount taken as empty carries. */
  const joined = (asked: string, askedPath: string, found: Extract<RouteResult, { entry: GraphNode }>) => {
    if (found.mountAssumed !== undefined) {
      notes.push(mountAssumedFinding(asked, askedPath, found.entry, found.mountAssumed));
    }
    return {
      entry: found.entry,
      runnersUp: found.runnersUp ?? [],
      ...(found.mountAssumed === undefined ? {} : { mountAssumed: found.mountAssumed }),
    };
  };
  for (const written of markers) {
    const routes = index.routesOf(written.service);
    if (routes === undefined) {
      notes.push(MARKER_FINDINGS.serviceUnknown(written, index.aliases?.() ?? []));
      continue;
    }
    // Named by an alias, the annotation means the service the alias names (P91).
    const marker = { ...written, service: index.serviceOf?.(written.service) ?? written.service };
    const from = callerApplicationIn(marker.service);
    let found = matchRoute(marker.method, marker.path, routes, from);
    // An annotation is written the way the caller sees the route, which is
    // without the prefix the service adds to all of them; the same retry an
    // address read from the code gets.
    if (!isMatch(found) && found.reason === 'not-found') {
      const prefixed = withGlobalPrefix(marker.path, routes);
      if (prefixed !== undefined) found = matchRoute(marker.method, prefixed, routes, from);
    }
    if (isMatch(found)) {
      reached.push(joined(marker.method, marker.path, found));
      continue;
    }
    // An annotation names the service, not which of its APIs at one address
    // it means: the same choice by name a base URL setting gets, by the
    // setting where the call has one and by the service otherwise (P61).
    const choice = found.reason === 'ambiguous' ? chooseAmong(routes, found.candidates, typeof env === 'string' ? env : marker.service) : undefined;
    if (choice?.kind === 'one') {
      notes.push(apiGuessedFinding(marker.method, marker.path, typeof env === 'string' ? env : marker.service, choice.api, choice.apis));
      reached.push({ entry: choice.entry, runnersUp: [], guessed: true });
    } else if (choice?.kind === 'tie') {
      notes.push(AMBIGUITY.api({ targetService: marker.service, method: marker.method, path: marker.path, candidates: found.candidates, apis: choice.apis }));
    } else if (choice?.kind === 'narrowed') {
      const candidates = choice.entries.map((entry) => entry.id);
      notes.push(AMBIGUITY.route({ targetService: marker.service, method: marker.method, path: marker.path, candidates }));
    } else notes.push(MARKER_FINDINGS.routeNotFound(marker));
  }
  const [first, ...rest] = reached;
  if (first !== undefined) {
    const { guessed, ...linked } = first;
    return {
      outcome: { kind: 'linked', via: guessed === true ? 'apiName' : 'marker', ...linked },
      ...(rest.length === 0 ? {} : { alsoLinked: rest.map(({ runnersUp: _, guessed: __, ...item }) => item) }),
      notes,
    };
  }

  // A request through a worker's binding goes where the deployment binds the
  // name, at its own path (P91).
  const binding = call.meta?.['binding'];
  if (typeof binding === 'string') {
    const bound = index.bindingOf?.(call, binding) ?? { kind: 'undeclared' };
    if (bound.kind === 'undeclared' && call.meta?.['bindingTyped'] === false) {
      // Only its shape said it was a binding, and nothing declares one by
      // that name: it may not be one at all, so nothing is said of it.
      return { outcome: { kind: 'dynamic' }, notes };
    }
    if (bound.kind !== 'service') {
      return {
        outcome: {
          kind: 'unknownBinding',
          binding,
          workers: bound.kind === 'unknown' ? bound.workers : [],
          services: bound.kind === 'unknown' ? bound.services : [],
        },
        notes,
      };
    }
    return within(bound.service, 'serviceBinding', {});
  }

  if (typeof env !== 'string') {
    // Nothing to look up: either it names a third party outright, or the
    // address was built at run time and there is nothing to read.
    const outcome: CallOutcome =
      typeof host === 'string' ? { kind: 'external' } : { kind: 'dynamic' };
    return { outcome, notes };
  }

  // A key a settings factory builds from a variable of the environment is
  // claimed by whoever claims the variable (P77).
  const variable = call.meta?.['baseUrlVariable'];
  const own = index.claimantsOf(env);
  const claiming = own.length === 0 && typeof variable === 'string' ? index.claimantsOf(variable) : own;
  // A setting no service claims may hold a function's own URL, which answers
  // every verb and path: the request reaches the function whatever it asks.
  const [url, ...urls] = claiming.length === 0 ? (index.functionUrlsOf?.(call.id) ?? []) : [];
  if (url !== undefined) {
    return {
      outcome: { kind: 'linked', via: 'functionUrl', entry: url, runnersUp: [] },
      ...(urls.length === 0 ? {} : { alsoLinked: urls.map((entry) => ({ entry })) }),
      notes,
    };
  }
  // Nobody claims it: what the setting is given may still say (P77).
  const valued = claiming.length === 0 ? index.baseUrlOf?.(call) : undefined;
  if (valued?.kind === 'external') {
    return { outcome: { kind: 'external', host: valued.host }, notes, baseUrl: valued.found };
  }
  if (valued?.kind === 'unsettled') {
    return { outcome: { kind: 'unknownEnv', env, claiming, values: valued }, notes };
  }
  const targetService = claiming.length === 1 ? claiming[0] : valued?.service;
  if (targetService === undefined) {
    return { outcome: { kind: 'unknownEnv', env, claiming }, notes };
  }
  const via = valued === undefined ? 'baseUrlEnv' : 'baseUrlValue';
  const taken = valued === undefined ? {} : { baseUrl: valued.found };

  // A value that is a whole address - a host and a path - is where the
  // request goes, path included (P91): `fetch(process.env.REINDEX_URL)` with
  // `REINDEX_URL=https://catalog.internal/items/reindex` asks for
  // `/items/reindex`. Where that answers nothing and the request's own path
  // does, the value's path is a mount in front of the service and the join
  // made without it stands, as it always did.
  const start = valued?.kind === 'service' ? pathOfValue(valued.found) : undefined;
  if (start !== undefined && typeof path === 'string' && wasRead(path)) {
    const whole = within(targetService, via, taken, normalizePath(`${start}/${path}`));
    if (whole.outcome.kind === 'linked') return whole;
    const plain = within(targetService, via, taken);
    return plain.outcome.kind === 'linked' ? plain : whole;
  }
  return within(targetService, via, taken);
};

/** The path a value found for a setting carries beyond its host, when it carries one (P91). */
export const pathOfValue = (found: FoundValue): string | undefined => {
  if (found.byName === true) return undefined;
  try {
    const path = new URL(found.value).pathname;
    return path === '' || path === '/' ? undefined : path;
  } catch {
    return undefined;
  }
};
