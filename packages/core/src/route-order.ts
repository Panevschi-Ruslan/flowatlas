/**
 * Which of two routes a router tries first (P385).
 *
 * Two kinds of router answer a request two routes both match. Some rank the
 * routes by how much of the address each spells out, whatever order they were
 * declared in: Fastify's (find-my-way), every file router, the front-end
 * routers. Others try them in the order they were registered and the first one
 * answers: Express, Koa's router, Hono, and NestJS on its default Express
 * adapter (the NestJS docs: "Nest registers routes in declaration order", and a
 * parametric route "can therefore silently shadow a more specific one").
 * NestJS on Fastify, or with `routeResolutionStrategy: 'specificity'` (v12),
 * ranks by specificity again.
 *
 * So `GET /orders/:id` declared above `GET /orders/latest` in one controller
 * answers every request for `/orders/latest`, and the second handler never
 * runs. Joining that request to the literal route, as ranking by specificity
 * does, puts its callers on code that is never reached.
 *
 * The order is decided here, once, for the linker's joins, the route audit's
 * finding and anything else that asks. What each reader records is plain data
 * on the route: the adapter that read it, its file and line, the receiver or
 * controller it was declared on, and - where the framework's own default was
 * not what the service chose - `routeOrder`. A NestJS route that may overlap a
 * route of another controller carries `controllerOrder`, the place its
 * controller is registered at, read from the module tree.
 */
import { normalizePath, PARAM_PLACEHOLDER, UNREAD_SPAN } from './ids.js';

/** The key on a route's meta saying how its router orders routes, where it is not the framework's default. */
export const ROUTE_ORDER_META = 'routeOrder';

/** The key on a NestJS route's meta giving the place its controller is registered at. */
export const CONTROLLER_ORDER_META = 'controllerOrder';

/**
 * How a router chooses among routes that all answer a request.
 *
 * `declaration`: the first registered answers. `specificity`: the one that
 * spells out most of the address answers. `unread`: the service chose how, and
 * what it chose could not be read.
 */
export type RouteOrder = 'declaration' | 'specificity' | 'unread';

/**
 * The readers whose routers try routes in registration order, by the adapter
 * name each writes on a route.
 *
 * Koa's router can be built with `exclusive`, which changes which route runs;
 * that option is not read, and a router built with it is read as the default.
 */
const DECLARATION_ORDER: ReadonlySet<string> = new Set(['nestjs-http', 'express-routes', 'koa-routes', 'hono-routes']);

/** What the order of two routes is decided from: a graph node or an entry a reader is minting. */
export interface OrderedRoute {
  readonly repo?: string;
  readonly file?: string;
  readonly line?: number;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** How the router a route is declared in chooses among routes. */
export const routeOrderOf = (route: OrderedRoute): RouteOrder => {
  const said = route.meta?.[ROUTE_ORDER_META];
  if (said === 'declaration' || said === 'specificity' || said === 'unread') return said;
  return DECLARATION_ORDER.has(text(route.meta?.['adapter'])) ? 'declaration' : 'specificity';
};

/** `ordersRouter` of `ordersRouter.get`: the value a route was registered on. */
const receiverOf = (route: OrderedRoute): string => {
  const registration = text(route.meta?.['registration']);
  const at = registration.lastIndexOf('.');
  return at < 0 ? registration : registration.slice(0, at);
};

/**
 * The router a route is declared in, as a reader would find it beside its
 * file: its NestJS controller, or the value it is registered on.
 */
export const routerOf = (route: OrderedRoute): string => {
  const controller = text(route.meta?.['controller']);
  if (controller !== '') return controller;
  const receiver = receiverOf(route);
  return receiver === '' ? (route.file ?? '') : receiver;
};

/**
 * Whether two routes are declared in one router, where the order between them
 * is the order of their lines: one controller in one file, or one receiver in
 * one file. A router mounted twice is one router at two addresses, each read
 * as its own route, and still one order.
 */
const sameRouter = (a: OrderedRoute, b: OrderedRoute): boolean => {
  if (a.file === undefined || a.file !== b.file) return false;
  const controller = text(a.meta?.['controller']);
  if (controller !== '' || text(b.meta?.['controller']) !== '') return controller === text(b.meta?.['controller']);
  const receiver = receiverOf(a);
  return receiver !== '' && receiver === receiverOf(b);
};

/**
 * Which of two routes their router tries first.
 *
 * `apart`: no order between them decides anything - another service, another
 * application, another reader, or a router that ranks by specificity.
 * `unread`: they share a router that tries routes in order, and the order
 * between these two was not read - declared in two files or on two receivers
 * whose mounts come in an order nobody read, two controllers whose place in the
 * module tree was not read, or a service whose choice of order was not read.
 */
export const registeredFirst = (a: OrderedRoute, b: OrderedRoute): 'a' | 'b' | 'unread' | 'apart' => {
  if (a.repo !== b.repo) return 'apart';
  if (text(a.meta?.['application']) !== text(b.meta?.['application'])) return 'apart';
  const adapter = text(a.meta?.['adapter']);
  if (adapter !== text(b.meta?.['adapter'])) return 'apart';
  const orders = [routeOrderOf(a), routeOrderOf(b)];
  if (orders.includes('specificity')) return 'apart';
  if (orders.includes('unread')) return 'unread';
  if (sameRouter(a, b)) {
    if (a.line === undefined || b.line === undefined || a.line === b.line) return 'unread';
    return a.line < b.line ? 'a' : 'b';
  }
  const first = a.meta?.[CONTROLLER_ORDER_META];
  const second = b.meta?.[CONTROLLER_ORDER_META];
  if (typeof first === 'number' && typeof second === 'number' && first !== second) return first < second ? 'a' : 'b';
  return 'unread';
};

const segmentsOf = (path: string): string[] => normalizePath(path).split('/').filter((segment) => segment.length > 0);

/** A parameter written as a name and nothing else: `:orderId`, not `:id(\\d+)`, `:lang?` or `v:id`. */
const PLAIN_PARAM = /^:[A-Za-z_$][\w$]*$/;

/**
 * Whether a route registered first answers every request a second route
 * answers, so a router trying them in order never reaches the second.
 *
 * Read strictly, because the claim is that code never runs. One verb, and not
 * `ALL`: a route for every verb is how a check is installed in front of others
 * (`router.all('/:id', load)`), and it hands on more often than it answers. No
 * wildcard on either side, for the same reason (`app.all('*', auth)`). The
 * same number of segments; where the second spells a segment out, the first
 * spells the same one or takes any value there with a plain parameter; and the
 * first takes a value somewhere the second spells one out. A parameter with a
 * pattern, an optional one or text around it may refuse the segment, so it
 * shadows nothing.
 */
export const shadowsByPath = (earlier: OrderedRoute, later: OrderedRoute): boolean => {
  const verb = text(earlier.meta?.['method']).toUpperCase();
  if (verb === '' || verb === 'ALL' || verb !== text(later.meta?.['method']).toUpperCase()) return false;
  const path = text(earlier.meta?.['path']);
  const other = text(later.meta?.['path']);
  if (path === '' || other === '' || path.includes(UNREAD_SPAN) || other.includes(UNREAD_SPAN)) return false;
  const first = segmentsOf(path);
  const second = segmentsOf(other);
  if (first.length === 0 || first.length !== second.length) return false;
  if (first.includes('*') || second.includes('*')) return false;
  const raw = text(earlier.meta?.['rawPath']);
  const written = raw === '' ? undefined : raw.split('/').filter((segment) => segment.length > 0);
  if (written !== undefined && written.length !== first.length) return false;
  let opened = false;
  for (let index = 0; index < first.length; index += 1) {
    const ours = first[index] as string;
    const theirs = second[index] as string;
    if (ours === PARAM_PLACEHOLDER) {
      if (written !== undefined && !PLAIN_PARAM.test(written[index] as string)) return false;
      if (theirs !== PARAM_PLACEHOLDER) opened = true;
      continue;
    }
    if (theirs === PARAM_PLACEHOLDER || ours.toLowerCase() !== theirs.toLowerCase()) return false;
  }
  return opened;
};
