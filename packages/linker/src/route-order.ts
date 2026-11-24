import { CONTROLLER_ORDER_META, ROUTE_ORDER_META, type OrderedRoute, type RouteOrder } from '@flowatlas/core';

/**
 * Which of two routes a router tries first (P385; moved out of the core by
 * P394, which names no router).
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
 * The order is decided here, once, for the joins, the route audit's finding
 * and anything else that asks. What each reader records is plain data on the
 * route (the core's `OrderedRoute`): the adapter that read it, its file and
 * line, the receiver or controller it was declared on, and - where the
 * framework's own default was not what the service chose - `routeOrder`. A
 * NestJS route that may overlap a route of another controller carries
 * `controllerOrder`, the place its controller is registered at, read from the
 * module tree. Whether a router path matches overlapping routes at all is the
 * core's `shadowsByPath`, which the readers ask too.
 */

/**
 * The readers whose routers try routes in registration order, by the adapter
 * name each writes on a route.
 *
 * Koa's router can be built with `exclusive`, which changes which route runs;
 * that option is not read, and a router built with it is read as the default.
 */
const DECLARATION_ORDER: ReadonlySet<string> = new Set(['nestjs-http', 'express-routes', 'koa-routes', 'hono-routes']);

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
