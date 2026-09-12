import { wasRead, type GraphNode } from '@flowatlas/core';
import { cmp } from './order.js';
import { isMatch, matchRoute, pathAnswers } from './route-match.js';

/** A reason, a sentence and what to do about it — everything but where it happened. */
export interface Finding {
  reason: string;
  message: string;
  hint: string;
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
}

/** What each way a call can end carries with it. */
interface Details {
  linked: { via: 'baseUrlEnv' | 'marker'; entry: GraphNode; runnersUp: readonly string[] };
  external: Record<never, never>;
  /** The service is known when the address said so; the route never was. */
  dynamic: { targetService?: string };
  unknownEnv: { env: string; claiming: readonly string[] };
  noRoute: { targetService: string; method: string; path: string; verbs: readonly string[] };
  ambiguous: {
    targetService: string;
    method: string;
    path: string;
    candidates: readonly string[];
  };
}

export type OutcomeKind = keyof Details;

export type CallOutcome = { [K in OutcomeKind]: { kind: K } & Details[K] }[OutcomeKind];

export interface Resolution {
  outcome: CallOutcome;
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
  noRoute: ({ targetService, method, path, verbs }) => ({
    reason: 'target-route-not-found',
    message: `target service ${targetService} has no route ${method} ${path}`,
    hint:
      `${verbs.length === 0 ? '' : `That path answers ${verbs.join(', ')}. `}` +
      `Route renamed? Check ${targetService}'s controllers, or annotate the call with @CallsService.`,
  }),
  ambiguous: ({ targetService, method, path, candidates }) => ({
    reason: 'ambiguous-route',
    message: `more than one route in ${targetService} answers ${method} ${path}`,
    hint: `Candidates: ${candidates.join(', ')}. Make the path more specific, or annotate the call with @CallsService.`,
  }),
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

/** Which verbs a path does answer, for when only the verb was wrong. */
const verbsAnswering = (path: string, routes: readonly GraphNode[]): string[] =>
  [
    ...new Set(
      routes
        .filter((route) => pathAnswers(String(route.meta?.['path'] ?? ''), path))
        .map((route) => String(route.meta?.['method'] ?? '')),
    ),
  ].sort(cmp);

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
  const method = String(call.meta?.['method'] ?? 'GET');
  const path = call.meta?.['path'];
  const env = call.meta?.['baseUrlEnv'];
  const host = call.meta?.['host'];

  const marker = index.markerOf(call.id);
  if (marker !== undefined) {
    const routes = index.routesOf(marker.service);
    if (routes === undefined) {
      notes.push(MARKER_FINDINGS.serviceUnknown(marker));
    } else {
      const found = matchRoute(marker.method, marker.path, routes);
      if (isMatch(found)) {
        return {
          outcome: {
            kind: 'linked',
            via: 'marker',
            entry: found.entry,
            runnersUp: found.runnersUp ?? [],
          },
          notes,
        };
      }
      notes.push(MARKER_FINDINGS.routeNotFound(marker));
    }
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
  let found = matchRoute(method, requested, routes);
  if (!isMatch(found) && found.reason === 'not-found') {
    const prefixed = withGlobalPrefix(requested, routes);
    if (prefixed !== undefined) found = matchRoute(method, prefixed, routes);
  }

  if (isMatch(found)) {
    return {
      outcome: {
        kind: 'linked',
        via: 'baseUrlEnv',
        entry: found.entry,
        runnersUp: found.runnersUp ?? [],
      },
      notes,
    };
  }
  if (found.reason === 'ambiguous') {
    return {
      outcome: {
        kind: 'ambiguous',
        targetService,
        method,
        path: requested,
        candidates: found.candidates,
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
    },
    notes,
  };
};
