/**
 * The order routers try routes in, as data on a route (P385), and the one
 * question about two routes' paths that order turns into a defect.
 *
 * Some routers rank the routes that all match a request by how much of the
 * address each spells out; others try them in the order they were registered,
 * and the first one answers. Under the second kind a route taking any value
 * with a parameter, registered above one that spells that value out, answers
 * every request for it, and the second handler never runs.
 *
 * Which routers are which is not known here: the linker decides the order
 * between two routes from what the readers wrote (P394). What each reader
 * records is plain data on the route: the adapter that read it, its file and
 * line, the receiver or controller it was declared on, and - where the
 * framework's own default was not what the service chose - `routeOrder`. A
 * route that may overlap a route of another controller carries
 * `controllerOrder`, the place its controller is registered at.
 */
import { normalizePath, PARAM_PLACEHOLDER, UNREAD_SPAN } from './ids.js';

/** The key on a route's meta saying how its router orders routes, where it is not the framework's default. */
export const ROUTE_ORDER_META = 'routeOrder';

/** The key on a route's meta giving the place the controller it is declared in is registered at. */
export const CONTROLLER_ORDER_META = 'controllerOrder';

/**
 * How a router chooses among routes that all answer a request.
 *
 * `declaration`: the first registered answers. `specificity`: the one that
 * spells out most of the address answers. `unread`: the service chose how, and
 * what it chose could not be read.
 */
export type RouteOrder = 'declaration' | 'specificity' | 'unread';

/** What the order of two routes is decided from: a graph node or an entry a reader is minting. */
export interface OrderedRoute {
  readonly repo?: string;
  readonly file?: string;
  readonly line?: number;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

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
