import { wasRead, type GraphNode } from '@flowatlas/core';
import {
  behindUnread,
  callingApplication,
  isMatch,
  matchRoute,
  verbsAnswering,
  type RouteResult,
} from './route-match.js';

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
  /** Routes a service serves. Empty when it serves none, undefined when unknown. */
  routesOf(service: string): readonly GraphNode[] | undefined;
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
}

/** What each way a call can end carries with it. */
interface Details {
  linked: {
    via: 'baseUrlEnv' | 'marker';
    entry: GraphNode;
    runnersUp: readonly string[];
    /** The settings whose part of the route's address was taken as empty (R144). */
    mountAssumed?: readonly string[];
  };
  external: Record<never, never>;
  /** The service is known when the address said so; the route never was. */
  dynamic: { targetService?: string };
  unknownEnv: { env: string; claiming: readonly string[] };
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
  unknownEnv: ({ env, claiming }) => ({
    reason: 'unknown-base-url-env',
    message:
      claiming.length === 0
        ? `no service declares ${env}`
        : `${env} is declared on services ${claiming.join(' and ')}`,
    hint:
      claiming.length === 0
        ? `Add ${env} to services[].baseUrlEnv of whichever service answers it.`
        : `Leave ${env} on the one service that answers it.`,
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
  ambiguous: (detail) => AMBIGUITY[detail.applications === undefined ? 'route' : 'application'](detail),
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
  'route' | 'application',
  (detail: Details['ambiguous']) => Finding
> = {
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

/** The finding an outcome carries, or nothing when the call resolved cleanly. */
export const findingFor = (outcome: CallOutcome): Finding | undefined => {
  const describe = FINDINGS[outcome.kind] as ((detail: CallOutcome) => Finding) | null;
  return describe === null ? undefined : describe(outcome);
};

/** The same table for the two ways an annotation can be wrong. */
const MARKER_FINDINGS = {
  serviceUnknown: (marker: CallsServiceMarker): Finding => ({
    reason: 'marker-service-unknown',
    message: `@CallsService names ${marker.service}, which is not a configured service`,
    hint: `Add ${marker.service} to services[] in flowatlas.config.json, or correct the annotation.`,
  }),
  routeNotFound: (marker: CallsServiceMarker): Finding => ({
    reason: 'marker-route-not-found',
    message: `@CallsService points at ${marker.method} ${marker.path}, which ${marker.service} does not serve`,
    hint: `Check ${marker.service}'s controllers, or correct the annotation.`,
  }),
};

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
  const method = String(call.meta?.['method'] ?? 'GET');
  const path = call.meta?.['path'];
  const env = call.meta?.['baseUrlEnv'];
  const host = call.meta?.['host'];

  const single = index.markerOf(call.id);
  const markers = index.markersOf?.(call.id) ?? (single === undefined ? [] : [single]);
  const reached: Array<{ entry: GraphNode; runnersUp: readonly string[]; mountAssumed?: readonly string[] }> = [];
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
  for (const marker of markers) {
    const routes = index.routesOf(marker.service);
    if (routes === undefined) {
      notes.push(MARKER_FINDINGS.serviceUnknown(marker));
      continue;
    }
    const from = callerApplicationIn(marker.service);
    let found = matchRoute(marker.method, marker.path, routes, from);
    // An annotation is written the way the caller sees the route, which is
    // without the prefix the service adds to all of them; the same retry an
    // address read from the code gets.
    if (!isMatch(found) && found.reason === 'not-found') {
      const prefixed = withGlobalPrefix(marker.path, routes);
      if (prefixed !== undefined) found = matchRoute(marker.method, prefixed, routes, from);
    }
    if (isMatch(found)) reached.push(joined(marker.method, marker.path, found));
    else notes.push(MARKER_FINDINGS.routeNotFound(marker));
  }
  const [first, ...rest] = reached;
  if (first !== undefined) {
    return {
      outcome: { kind: 'linked', via: 'marker', ...first },
      ...(rest.length === 0 ? {} : { alsoLinked: rest.map(({ runnersUp: _, ...item }) => item) }),
      notes,
    };
  }

  if (typeof env !== 'string') {
    // Nothing to look up: either it names a third party outright, or the
    // address was built at run time and there is nothing to read.
    const outcome: CallOutcome =
      typeof host === 'string' ? { kind: 'external' } : { kind: 'dynamic' };
    return { outcome, notes };
  }

  const claiming = index.claimantsOf(env);
  const targetService = claiming.length === 1 ? claiming[0] : undefined;
  if (targetService === undefined) {
    return { outcome: { kind: 'unknownEnv', env, claiming }, notes };
  }

  // Knowing which service is asked is not knowing what is asked of it. A route
  // guessed here would be a route this service does not serve, reported as
  // drift that does not exist.
  //
  // A path read in part is not a path read. `/orders/${…}/items` would once
  // have matched `/orders/:param/items` and produced an edge marked `static`
  // towards a route this call may never reach.
  if (typeof path !== 'string' || !wasRead(path)) {
    return { outcome: { kind: 'dynamic', targetService }, notes };
  }

  const routes = index.routesOf(targetService) ?? [];
  const requested = path;
  const from = callerApplicationIn(targetService);
  let found = matchRoute(method, requested, routes, from);
  if (!isMatch(found) && found.reason === 'not-found') {
    const prefixed = withGlobalPrefix(requested, routes);
    if (prefixed !== undefined) found = matchRoute(method, prefixed, routes, from);
  }

  if (isMatch(found)) {
    return { outcome: { kind: 'linked', via: 'baseUrlEnv', ...joined(method, requested, found) }, notes };
  }
  if (found.reason === 'ambiguous') {
    return {
      outcome: {
        kind: 'ambiguous',
        targetService,
        method,
        path: requested,
        candidates: found.candidates,
        ...(found.applications === undefined ? {} : { applications: found.applications }),
      },
      notes,
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
  };
};
