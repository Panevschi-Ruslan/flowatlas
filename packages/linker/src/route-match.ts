import { normalizePath, wasRead, type GraphNode } from '@flowatlas/core';

export interface RouteMatch {
  entry: GraphNode;
  /** Ids of the routes that were beaten on specificity, when any were. */
  runnersUp?: string[];
}

export interface RouteMiss {
  reason: 'not-found' | 'ambiguous';
  /** Ids of the routes that could have answered, when more than one could. */
  candidates: string[];
  /**
   * The applications the candidates belong to, when they are not all in one.
   *
   * Present only where it changes what the ambiguity *is* — see
   * {@link matchRoute} — so a caller that ignores it reads the same answer it
   * read before, and one that does not can say the truer sentence.
   */
  applications?: string[];
}

export type RouteResult = RouteMatch | RouteMiss;

export const isMatch = (result: RouteResult): result is RouteMatch => 'entry' in result;

const segmentsOf = (path: string): string[] =>
  normalizePath(path).split('/').filter((segment) => segment.length > 0);

/**
 * Whether a route answers a request for this path.
 *
 * A hole on the route side accepts any single segment of the request; a literal
 * accepts only itself. A trailing wildcard accepts everything below it. Nothing
 * is fuzzy: a near miss is a miss, because an edge drawn here claims one service
 * really does reach the other.
 *
 * A path either side could not be read fully answers nothing. The route's own
 * hole is a hole it declares and any value fills; a hole in what was read stands
 * for text nobody has seen, and may not even be one segment. Callers turn this
 * into a call reported as dynamic; the check is repeated here so that a caller
 * that forgets cannot invent an edge.
 */
const pathAnswers = (routePath: string, requestPath: string): boolean => {
  if (!wasRead(routePath) || !wasRead(requestPath)) return false;
  // Neither side is a path. Two empty strings compared segment by segment agree
  // about nothing and used to answer yes, so an entry whose path could not be
  // read matched a request whose path could not be read either.
  if (routePath === '' || requestPath === '') return false;
  const route = segmentsOf(routePath);
  const request = segmentsOf(requestPath);
  for (let index = 0; index < route.length; index += 1) {
    const segment = route[index];
    if (segment === undefined) return false;
    // Only at the end, which is what the sentence above promises and what every
    // router this tool reads does. Returning on the first `*` at any position
    // threw away the rest of the route: `/files/*/download` answered
    // `/files/a/anything`, and the edge said one service reaches another
    // through an address it does not serve.
    if (segment === '*') {
      if (index === route.length - 1) return request.length >= route.length;
      if (request[index] === undefined) return false;
      continue;
    }
    const asked = request[index];
    if (asked === undefined) return false;
    if (segment === ':param') continue;
    // Express and Nest both match a path without regard to case unless they are
    // told otherwise, so `/Orders/42` really does reach `/orders/:id`. Comparing
    // exactly reported that as a route the target does not serve: a finding
    // about a disagreement that is not there, which costs a reader as much as a
    // missing edge.
    if (segment.toLowerCase() !== asked.toLowerCase()) return false;
  }
  return route.length === request.length;
};

/** The application an entry belongs to, or the empty string where it has none. */
const applicationOf = (entry: GraphNode): string => String(entry.meta?.['application'] ?? '');

const methodAnswers = (routeMethod: string, requestMethod: string): boolean => {
  // Both sides, not one. The extractors record a verb in upper case, but a
  // route that arrived any other way answered nothing at all rather than
  // saying why.
  const declared = routeMethod.toUpperCase();
  return declared === 'ALL' || declared === requestMethod.toUpperCase();
};

/**
 * How much of a route is spelled out, most telling part first.
 *
 * Three numbers rather than one, because the two kinds of hole are not worth the
 * same. A `*` opens the whole of the rest of the address; a `:param` opens one
 * segment of it. `/api/*` and `/api/orders/:param` have one hole each and
 * counting holes made them a tie, so a worker that hands everything under `/api`
 * to the application behind it drew level with every route that application
 * serves and every request to it became ambiguous.
 *
 * Wildcards first, then holes, then how many segments are spelled out — which
 * only ever separates two wildcard routes, since two routes that answer the same
 * request and hold no wildcard are the same length. That is the order every
 * router this tool reads tries its routes in.
 */
const specificityOf = (routePath: string): [number, number, number] => {
  const segments = segmentsOf(routePath);
  const wildcards = segments.filter((segment) => segment === '*').length;
  const params = segments.filter((segment) => segment === ':param').length;
  return [wildcards, params, -(segments.length - wildcards - params)];
};

const moreSpecific = (a: readonly number[], b: readonly number[]): number => {
  for (let index = 0; index < a.length; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference;
  }
  return 0;
};

/**
 * Finds the route that answers a request.
 *
 * When two routes answer and one spells out a segment the other leaves open,
 * the spelled-out one wins: that is what every router this tool reads does, and
 * refusing to choose there would lose a real edge. A genuine tie is a different
 * matter, since which route answers then depends on registration order, and the
 * honest answer is that it cannot be told from here.
 *
 * A route beaten by a catch-all's own margin is not a runner-up. The note a
 * runner-up produces warns that the framework, not this, decided which of two
 * routes answers; no framework hesitates between a route and a wildcard.
 *
 * ## Two routes of one application, and two applications
 *
 * Since R119 gave an address room for the application that serves it, two
 * entries can answer one request without either of them being a mistake: a
 * worker and an API that both serve `/health` are two programs, each answering
 * on its own port, and neither shadows the other. That arrives here looking
 * exactly like the old tie — two matching entries of equal specificity — and the
 * two facts must not be spelled the same way, because what a reader should do
 * about them is opposite. A tie inside one application is a defect in that
 * application: one of the two handlers is dead code that still type-checks, and
 * somebody should delete a route. A tie across applications is a defect in
 * nothing, and the only thing to fix is the tool's own belief that it knows
 * where the request went.
 *
 * So the result still says `ambiguous` — it is still a request this cannot place
 * — and it names the applications when they differ, which is what lets the row
 * written about it carry a different reason and a different sentence.
 *
 * **It is not resolved, deliberately.** Which application answers a request
 * arriving from outside the service is a deployment question: the two listen on
 * different ports, behind whatever routes to them, and none of that is in any
 * source this reads. Choosing one would be inventing the answer, and the edge
 * would claim a caller reaches a program it may never touch. Naming both is the
 * honest answer and it is a useful one — it tells a reader that their request
 * lands in one of two named places.
 *
 * A caller *inside* one of those applications is the easier case and would want
 * its own application preferred, and that is not done here for want of the
 * input: no node in the graph records which application a call site belongs to,
 * and every call the linker resolves through a settings key comes from another
 * service, where there is no such thing to record. Accepting the calling
 * application as an argument nothing can supply would be a parameter that only
 * ever arrives absent.
 */
export const matchRoute = (
  method: string,
  path: string,
  entries: readonly GraphNode[],
): RouteResult => {
  const wanted = method.toUpperCase();
  const matching = entries.filter((entry) => {
    if (entry.type !== 'entry' || entry.kind !== 'http') return false;
    const routeMethod = String(entry.meta?.['method'] ?? '');
    const routePath = String(entry.meta?.['path'] ?? '');
    return methodAnswers(routeMethod, wanted) && pathAnswers(routePath, path);
  });

  if (matching.length === 1) return { entry: matching[0] as GraphNode };
  if (matching.length === 0) return { reason: 'not-found', candidates: [] };

  const ranked = matching.map((entry) => specificityOf(String(entry.meta?.['path'] ?? '')));
  const winning = ranked.reduce((best, rank) => (moreSpecific(rank, best) < 0 ? rank : best));
  const best = matching.filter((_, index) => moreSpecific(ranked[index] as number[], winning) === 0);
  if (best.length > 1) {
    const applications = [...new Set(best.map(applicationOf))].sort();
    return {
      reason: 'ambiguous',
      candidates: matching.map((entry) => entry.id).sort(),
      ...(applications.length > 1 ? { applications } : {}),
    };
  }
  return {
    entry: best[0] as GraphNode,
    runnersUp: matching
      .filter((entry, index) => entry !== best[0] && (ranked[index] as number[])[0] === winning[0])
      .map((entry) => entry.id)
      .sort(),
  };
};

/**
 * Whether a route answered only because it is a catch-all in front of a service
 * that also spells its routes out.
 *
 * A worker that hands everything under `/api/*` to the application behind it
 * answers every request, including one the application has no route for. The
 * edge to the catch-all is real, but it says nothing about whether the request
 * will be served, and a renamed route hides behind it indefinitely.
 */
export const answeredOnlyByWildcard = (entry: GraphNode, routes: readonly GraphNode[]): boolean => {
  const path = String(entry.meta?.['path'] ?? '');
  if (!segmentsOf(path).includes('*')) return false;
  return routes.some(
    (route) =>
      route.type === 'entry' &&
      route.kind === 'http' &&
      !segmentsOf(String(route.meta?.['path'] ?? '')).includes('*'),
  );
};

export { pathAnswers };
