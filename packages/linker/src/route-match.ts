import { normalizePath, UNREAD_SPAN, wasRead, type GraphNode } from '@flowatlas/core';
import { cmp } from './order.js';

export interface RouteMatch {
  entry: GraphNode;
  /** Ids of the routes that were beaten on specificity, when any were. */
  runnersUp?: string[];
  /**
   * The settings whose part of the route's address was taken as empty, when the
   * route answered only because it was (R144). See {@link assumedMountOf}.
   */
  mountAssumed?: readonly string[];
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

/**
 * # A mount taken as empty (R144)
 *
 * The one place this is decided. Every join is decided through
 * {@link answeringAt}, so the two linkers, the annotations and the queries that
 * find an entry by address all hold the same opinion of it.
 *
 * R89's rule is that an address with a part nobody read is never joined, and it
 * stands. This is one exception to it, taken narrowly and on purpose: a part at
 * the very **front** of a route's address, read from settings that the service's
 * committed environment files leave **empty or absent in every one of them**, is
 * read as where the deployment mounts the service and taken as empty. It is the
 * assumption the client side already makes of a base read from a setting (R114,
 * R128) — a request is recorded without the base it is sent to — so taking it
 * here puts both ends on the same footing rather than inventing a new one.
 *
 * A join made this way is not a join made from an address read in full, and it
 * says so: the match carries the settings it assumed, the edge is weaker, and a
 * row names the settings. Everything else with a hole keeps R89's rule — a hole
 * in the middle, a setting some environment file does set, a service with no
 * environment file to consult, a part computed from anything but settings —
 * because each is a place where the empty value is a guess rather than what the
 * repository itself says.
 *
 * The facts come from the reader of the application, which is the only thing
 * that can see the environment files; the verdict is made here and nowhere else.
 */
export const assumedMountOf = (entry: GraphNode): { path: string; settings: string[] } | undefined => {
  const mount = entry.meta?.['mount'];
  if (typeof mount !== 'object' || mount === null) return undefined;
  const { settings, setIn, envFiles } = mount as Record<string, unknown>;
  if (!Array.isArray(settings) || settings.length === 0) return undefined;
  if (!settings.every((setting): setting is string => typeof setting === 'string')) return undefined;
  // No file to consult is not every file agreeing: nothing was said at all.
  if (typeof envFiles !== 'number' || envFiles === 0) return undefined;
  if (!Array.isArray(setIn) || setIn.length > 0) return undefined;
  const path = String(entry.meta?.['path'] ?? '');
  const leading = `/${UNREAD_SPAN}`;
  if (!path.startsWith(leading)) return undefined;
  const rest = path.slice(leading.length);
  if (!wasRead(rest)) return undefined;
  return { path: normalizePath(`/${rest}`), settings: [...settings].sort(cmp) };
};

/**
 * Whether an entry answers a request for this path, and on what footing.
 *
 * `read` is an address read in full; `mount` is one that answers only once its
 * leading part is taken as empty, carrying the settings that part is read from.
 */
export type Answer = { footing: 'read'; path: string } | { footing: 'mount'; path: string; settings: string[] };

export const answeringAt = (entry: GraphNode, requestPath: string): Answer | undefined => {
  const routePath = String(entry.meta?.['path'] ?? '');
  if (pathAnswers(routePath, requestPath)) return { footing: 'read', path: routePath };
  const assumed = assumedMountOf(entry);
  return assumed !== undefined && pathAnswers(assumed.path, requestPath)
    ? { footing: 'mount', path: assumed.path, settings: assumed.settings }
    : undefined;
};

/** Which verbs a path does answer, for when only the verb was wrong. */
export const verbsAnswering = (path: string, routes: readonly GraphNode[]): string[] =>
  [
    ...new Set(
      routes
        .filter((route) => answeringAt(route, path) !== undefined)
        .map((route) => String(route.meta?.['method'] ?? '')),
    ),
  ].sort(cmp);

/** The application a node belongs to, or the empty string where it has none. */
const applicationOf = (node: GraphNode): string => String(node.meta?.['application'] ?? '');

/**
 * The application a call site is written in, when the graph recorded one.
 *
 * The same key an entry carries, read off the caller: since R132 a request node
 * records which application it belongs to, by the same reading and the same
 * judgement that put the application into the entry's identity. Empty means the
 * service has one address space, or the caller is not in any application read —
 * either way there is nothing to prefer, which is what `undefined` says here.
 *
 * Only ever meaningful within one service, since an application is named by
 * where it sits in a repository. Callers pass it only where the routes being
 * matched are the caller's own service's; see {@link matchRoute}.
 */
export const callingApplication = (call: GraphNode): string | undefined => {
  const application = applicationOf(call);
  return application === '' ? undefined : application;
};

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
 * A caller *inside* one of those applications is the easier case, and since
 * R132 it is answered: `from` is the application the call site is written in,
 * and where any entry belongs to it the rest of the service is not a candidate.
 * A component in `examples/blog` asking for `/api/orders` means its own
 * application's `/api/orders` and nothing else, and no deployment decides that
 * — it is what the framework does with a relative address.
 *
 * `from` is absent for every caller outside, which is most of them: a request
 * from another service has no application of this service to be in, and a
 * service with one address space records none. Absent leaves the paragraphs
 * above exactly as they were, which is the point — the refusal is right for a
 * request from outside and is not being walked back.
 *
 * It is the caller's job to pass `from` only where the entries are the caller's
 * own service's. An application is named by where it sits in a repository, so
 * `examples/blog` in one service names nothing in another.
 */
export const matchRoute = (
  method: string,
  path: string,
  entries: readonly GraphNode[],
  from?: string,
): RouteResult => {
  const wanted = method.toUpperCase();
  const answers = new Map<GraphNode, Answer>();
  for (const entry of entries) {
    if (entry.type !== 'entry' || entry.kind !== 'http') continue;
    if (!methodAnswers(String(entry.meta?.['method'] ?? ''), wanted)) continue;
    const answer = answeringAt(entry, path);
    if (answer !== undefined) answers.set(entry, answer);
  }
  const answering = [...answers.keys()];
  /** The match, saying so when it rests on a mount taken as empty. */
  const matched = (entry: GraphNode, runnersUp?: string[]): RouteMatch => {
    const answer = answers.get(entry);
    return {
      entry,
      ...(runnersUp === undefined ? {} : { runnersUp }),
      ...(answer?.footing === 'mount' ? { mountAssumed: answer.settings } : {}),
    };
  };

  // A request written inside an application means that application's address,
  // and the rest of the service is not a candidate for it at all. Applied
  // before specificity rather than as a tie-break, because it is not one: a
  // caller's own `/api/orders` is what it asked for even where another
  // application spells the address out more fully, and on the repository this
  // was measured against the answer chosen for 35 of 36 such requests was
  // another application's `/api/*` (R132).
  const own = from === undefined ? [] : answering.filter((entry) => applicationOf(entry) === from);
  const matching = own.length === 0 ? answering : own;

  if (matching.length === 1) return matched(matching[0] as GraphNode);
  if (matching.length === 0) return { reason: 'not-found', candidates: [] };

  const ranked = matching.map((entry) => specificityOf(answers.get(entry)?.path ?? ''));
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
  return matched(
    best[0] as GraphNode,
    matching
      .filter((entry, index) => entry !== best[0] && (ranked[index] as number[])[0] === winning[0])
      .map((entry) => entry.id)
      .sort(),
  );
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
  // Within the catch-all's own application, because that is the application
  // behind it. A service with two applications has two address spaces, and
  // routes another one spells out say nothing about what this one serves:
  // counting them made a request that landed on its own application's catch-all
  // report that no route of the service spells it out, which is a sentence
  // about the wrong program (R132). A service with one application compares
  // against all of its routes, as it always did.
  const application = applicationOf(entry);
  return routes.some(
    (route) =>
      route.type === 'entry' &&
      route.kind === 'http' &&
      applicationOf(route) === application &&
      !segmentsOf(String(route.meta?.['path'] ?? '')).includes('*'),
  );
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
 * read were left open, as `service METHOD path`.
 *
 * Used for a sentence and never for an edge. Joining here is the prefix-tolerant
 * retry R114 declined: a hole may stand for anything, so a match through one is
 * a possibility and not a fact, and an edge claims a fact. The one hole that is
 * joined across is decided by {@link assumedMountOf}, not here. What this does
 * settle is that "nothing serves this" is not known either, and a row saying so
 * is the most confident false thing the report can print. A route of which
 * nothing but the hole was read is left out, because it would be named beside
 * every request there is.
 *
 * Here rather than beside either linker because both ask it: a request from a
 * browser and one from another service meet the same hole (R137, R144).
 */
export const behindUnread = (method: string, path: string, routes: readonly GraphNode[]): string[] => {
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

export { pathAnswers };
