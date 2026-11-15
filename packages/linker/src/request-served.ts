import { normalizePath, wasRead, type GraphNode } from '@flowatlas/core';
import { callingApplication, catchAllBehind, isMatch, matchRoute, type RouteResult } from './route-match.js';

/** A caller may leave out a prefix the service adds to all of its routes. */
export const withGlobalPrefix = (path: string, routes: readonly GraphNode[]): string | undefined => {
  const prefix = routes.map((route) => route.meta?.['globalPrefix']).find((value) => typeof value === 'string');
  return typeof prefix === 'string' ? `/${prefix}/${path}`.replace(/\/+/g, '/') : undefined;
};

/**
 * Whether a service serves what a request asks of it (P300): asked where only
 * a framework's assumed default port places the service at an address, which
 * is no evidence the request is meant for it.
 */
export type ServesRequest = (service: string) => boolean;

/** What a request asks: its verb, the paths it may reach the server at, and whether it sends a GraphQL operation. */
export interface AskedRequest {
  readonly method: string;
  /** Every path the request may be asked at, the one under a value's path first; none where nothing is read. */
  readonly paths: readonly string[];
  readonly operation?: boolean;
  /** The request itself, for the application a caller's own service answers it from. */
  readonly call?: GraphNode;
}

/** A GraphQL endpoint at exactly the path, or a handler written at exactly it for the verb. */
const endpointAt = (routes: readonly GraphNode[], path: string): boolean =>
  routes.some(
    (route) =>
      route.type === 'entry' &&
      route.kind === 'http' &&
      route.meta?.['method'] === 'POST' &&
      normalizePath(String(route.meta?.['path'] ?? '')) === path,
  );

/**
 * Whether a service serves a request, by its routes (P300): a route for its
 * verb and path (a prefix the service adds to every route taken into
 * account), or a catch-all that answers a path read in part; an operation, a
 * GraphQL endpoint at its path, or a handler at exactly it. A request whose
 * path nothing read is served by no one.
 */
export const servesRequest =
  (routesOf: (service: string) => readonly GraphNode[] | undefined, asked: AskedRequest): ServesRequest =>
  (service) => {
    const routes = routesOf(service) ?? [];
    const from = asked.call !== undefined && asked.call.repo === service ? callingApplication(asked.call) : undefined;
    const answers = (result: RouteResult): boolean => isMatch(result) || result.reason === 'ambiguous';
    return asked.paths.some((raw) => {
      if (raw === '') return false;
      const path = normalizePath(raw);
      if (asked.operation === true) {
        if (!wasRead(path)) return false;
        const prefixed = withGlobalPrefix(path, routes);
        return endpointAt(routes, path) || (prefixed !== undefined && endpointAt(routes, normalizePath(prefixed)));
      }
      if (!wasRead(path)) return catchAllBehind(asked.method, path, routes, from) !== undefined;
      if (answers(matchRoute(asked.method, path, routes, from))) return true;
      const prefixed = withGlobalPrefix(path, routes);
      return prefixed !== undefined && answers(matchRoute(asked.method, prefixed, routes, from));
    });
  };

/** The path an address carries after its host, or nothing (`http://localhost:3000/api` is `/api`). */
export const pathOfAddress = (address: string): string | undefined => {
  try {
    const path = new URL(address).pathname;
    return path === '' || path === '/' ? undefined : path;
  } catch {
    return undefined;
  }
};

/**
 * The paths a request under an address may reach a server at: the address's
 * path with the request's after it, then the request's alone, as a join
 * under a value tries them (P91).
 */
export const pathsUnder = (address: string, path: unknown): string[] => {
  if (typeof path !== 'string') return [];
  const start = pathOfAddress(address);
  return start === undefined ? [path] : [normalizePath(`${start}/${path}`), path];
};

/** The procedures a service declares, as the procedure index answers them. */
export interface ProceduresDeclared {
  proceduresOf(service: string): ReadonlyMap<string, GraphNode>;
  matching?(service: string, procedure: string): GraphNode | undefined;
}

/**
 * Whether a service serves a procedure a client's link asks for (P305), asked
 * where only a framework's assumed default port places it at the link's
 * address, as a request's route is (P300): it declares the procedure - by its
 * key, or by a pattern the path matches - or, for a gRPC method, it
 * implements the gRPC service the method is of, which the procedure's own
 * resolution then says the method is missing from.
 */
export const servesProcedure =
  (index: ProceduresDeclared, procedure: string): ServesRequest =>
  (service) => {
    const declared = index.proceduresOf(service);
    if (declared.has(procedure) || index.matching?.(service, procedure) !== undefined) return true;
    const grpc = /^(grpc:[^/]+\/)[^/]+$/.exec(procedure)?.[1];
    return grpc !== undefined && [...declared.keys()].some((key) => key.startsWith(grpc));
  };
