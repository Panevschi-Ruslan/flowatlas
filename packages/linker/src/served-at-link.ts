import { matchServedAt, SERVED_AT_META, servedAtOf, type GraphNode, type ServedAt } from '@flowatlas/core';
import type { Finding } from './http-link.js';
import { cmp } from './order.js';
import { isMatch, matchRoute } from './route-match.js';

/**
 * A request whose address is written out at the place a deployment's API is
 * served, with the part the platform assigns in it (P284).
 *
 * `https://<id>.<gateway host of a region>/<stage>/orders` names an API by an
 * id no file of the project holds. The routes of every API a deployment
 * declares record where it is served (`servedAt`): the host with that id left
 * open, and the stage in front of every route. Where exactly one API of the
 * project is served at the host and stage the request writes, it is taken as
 * that API's, the path after the stage asked of its routes - a guess, because
 * another API of the same place would read the same, and the edge and a note
 * say so. Of several APIs served there, the ones with a route that answers
 * are asked before the rest, a stage the deployment fixes before one it
 * leaves to whoever runs it, and of those one it deploys to by default at the
 * stage the request writes before the rest (P294); where several are still
 * left, a row names them.
 */

/** The API a request was taken as, and what it asks of it. */
export interface ServedApi {
  readonly service: string;
  readonly api: string;
  /** The path asked of the API, after its stage. */
  readonly path: string;
  /** The routes of that API. */
  readonly routes: readonly GraphNode[];
  readonly served: ServedAt;
  /** The segments the request writes where the stage is. */
  readonly written: readonly string[];
  /** The address as the request writes it. */
  readonly address: string;
}

export type ServedAnswer =
  | { readonly kind: 'one'; readonly found: ServedApi }
  | { readonly kind: 'several'; readonly host: string; readonly apis: readonly string[] };

/** Every route of every service, read as where its API is served. */
export const apiServedAt = (
  method: string,
  host: string,
  path: string,
  address: string,
  services: readonly string[],
  routesOf: (service: string) => readonly GraphNode[] | undefined,
): ServedAnswer | undefined => {
  const byApi = new Map<string, { found: ServedApi; routes: GraphNode[]; exact: boolean }>();
  for (const service of services) {
    for (const route of routesOf(service) ?? []) {
      for (const served of servedAtOf(route.meta?.[SERVED_AT_META])) {
        const match = matchServedAt(host, path, served);
        if (match === undefined) continue;
        // An HTTP API and a REST API of one service may share a name; where each is served tells them apart.
        const key = [service, served.api, served.host, ...served.base].join('\0');
        const at = byApi.get(key) ?? {
          found: { service, api: served.api, path: match.path, routes: [], served, written: match.written, address },
          routes: [],
          exact: !served.base.includes('*'),
        };
        at.routes.push(route);
        byApi.set(key, at);
      }
    }
  }
  const all = [...byApi.values()];
  // An API with a route for the request, before one without (an HTTP API at
  // its default stage is served at every path of the host its REST API is).
  const answering = all.filter((each) => {
    const found = matchRoute(method, each.found.path, each.routes);
    return isMatch(found) || found.reason === 'ambiguous';
  });
  const among = answering.length > 0 ? answering : all;
  const exact = among.filter((each) => each.exact);
  // Of the stages left to whoever deploys, the ones deployed to where nothing chooses at the stage the request writes (P294).
  const byDefault = among.filter((each) => !each.exact && each.found.served.chosenDefault !== undefined && each.found.written.join('/') === each.found.served.chosenDefault);
  const asked = exact.length > 0 ? exact : byDefault.length > 0 ? byDefault : among;
  const [only] = asked;
  if (only === undefined) return undefined;
  if (asked.length === 1) return { kind: 'one', found: { ...only.found, routes: only.routes } };
  return { kind: 'several', host, apis: asked.map((each) => `${each.found.service} ${each.found.api}`).sort(cmp) };
};

/** The place an API is served, as a person reads it: `*.gateway.example.test/prod`. */
const placeOf = (served: ServedAt): string => `${served.host}${served.base.map((segment) => `/${segment}`).join('')}`;

/** What is said beside a request taken as an API's by where it is served. `info`: nothing is wrong. */
export const servedAtFinding = (found: ServedApi): Finding => {
  const chosen = found.served.base.includes('*');
  const stage = found.written.join('/');
  return {
    reason: 'base-url-from-files',
    level: 'info',
    message:
      `${found.address} names its API by an id no file holds; it is taken as ${found.api} of ${found.service}, the API of the project served at ${placeOf(found.served)} with a route for it` +
      (chosen
        ? `, at whatever stage it is run with (${found.served.chosenDefault ?? 'one'} where none is given), so ${stage === '' ? 'the address' : `the stage ${stage}`} is taken as one of its`
        : '') +
      `, and the request as one for ${found.path} on it`,
    hint: 'Read the address from the deployment - its endpoint output or a reference to the API - so it is said outright; another API served at the same place would read the same.',
  };
};

/** What is said where several APIs are served where the request is written. */
export const servedAmbiguousFinding = (method: string, path: string, host: string, apis: readonly string[]): Finding => ({
  reason: 'ambiguous-route-target',
  message: `${method} ${host}${path} names its API by an id no file holds, and ${apis.length} APIs of the project are served there: ${apis.join(', ')}`,
  hint: 'Set services[].hosts of the service whose API it is to this host, or annotate the request with @flowatlas-calls <service> <METHOD> <path>.',
});
