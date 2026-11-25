import type { GraphNode } from '@flowatlas/core';
import { ownerOf, type GraphDb } from '@flowatlas/linker';

/**
 * Where the requests a method sends land (P377), said on the one node an
 * answer is about: who_calls' target, a find_symbol match, get_source's
 * header. An agent asking "which handler does this front-end method's
 * request land on" reads it there, rather than the client's source and its
 * base class to rebuild the address.
 *
 * The requests are the ones the method sends itself, and the ones the code it
 * calls in its own service sends for it: a helper of its own class, a base
 * class's verb helper, a client wrapper function. A call into a class its
 * class injects is another service's request, said on that service's method,
 * so a screen's method does not repeat its client's requests.
 */

/** A request joined to a route: the route, and the code handling it there. */
export interface RequestLanding {
  route: string;
  by?: string;
}

/** A request joined to no route, as written: the verb and the address read. */
export interface RequestUnjoined {
  unjoined: string;
}

/** How many requests past the ones listed, where there were more than `MOST_REQUESTS`: the list's last row. */
export interface RequestsMore {
  more: number;
}

/**
 * One list, so no two keys a model could confuse (P393, after P-18: it was
 * `requests`, `requestsUnjoined` and `requestsMore`): each row a route
 * joined, `{route, by}`, or a request joined to none, `{unjoined}`, and
 * past eight a last row `{more}` counting the rest.
 */
export interface RequestsSaid {
  requests?: Array<RequestLanding | RequestUnjoined | RequestsMore>;
}

/** The nodes a request is drawn as. */
const REQUEST_TYPES: ReadonlySet<string> = new Set(['ui_api_call', 'http_out']);

/** The edges joining a request to the route it lands on. */
const REQUEST_EDGES = ['hits', 'http_calls'] as const;

/** The nodes that send requests: code. */
const CODE_TYPES: ReadonlySet<string> = new Set(['method', 'function']);

/** The code handling a route, where the graph draws it. */
const HANDLER_TYPES: ReadonlySet<string> = new Set(['method', 'function']);

/** How far into its own service's code a method's requests are looked for. */
const HELPER_HOPS = 2;

/** The most requests one node lists; the rest are counted. */
export const MOST_REQUESTS = 8;

/** The classes a class injects: a call into one of them is that class's request, not this method's. */
const injectedBy = (db: GraphDb, classId: string | undefined): Set<string> =>
  new Set(classId === undefined ? [] : db.edgesFrom(classId, ['injects']).map((edge) => edge.to));

/** The request nodes a method sends, itself first, then through its helpers, each once. */
const requestNodesOf = (db: GraphDb, start: GraphNode): GraphNode[] => {
  const found: GraphNode[] = [];
  const seen = new Set<string>([start.id]);
  const injected = injectedBy(db, ownerOf(start.id));
  let frontier = [start];
  for (let hop = 0; hop <= HELPER_HOPS && frontier.length > 0; hop += 1) {
    const next: GraphNode[] = [];
    for (const from of frontier) {
      for (const edge of db.edgesFrom(from.id, ['calls'])) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        const to = db.node(edge.to);
        if (to === undefined || to.repo !== start.repo) continue;
        if (REQUEST_TYPES.has(to.type)) found.push(to);
        else if (hop < HELPER_HOPS && CODE_TYPES.has(to.type)) {
          const owner = ownerOf(to.id);
          if (owner === undefined || !injected.has(owner)) next.push(to);
        }
      }
    }
    frontier = next;
  }
  return found;
};

/** The code a route hands the request to. */
const handlerOf = (db: GraphDb, routeId: string): string | undefined =>
  db.edgesFrom(routeId, ['handles']).find((edge) => HANDLER_TYPES.has(db.node(edge.to)?.type ?? ''))?.to;

/** A request joined to nothing, as written: `POST ${apiUrl}/admin/:param/catalog/export`. */
const unjoinedSaid = (request: GraphNode): string => {
  const method = request.meta?.['method'];
  const url = request.meta?.['url'];
  if (typeof url !== 'string' || url === '') return request.label;
  return typeof method === 'string' && method !== '' ? `${method} ${url}` : url;
};

/** Where the requests a method sends land; nothing for a node that sends none or is not code. */
export const requestsOf = (db: GraphDb, node: GraphNode | undefined): RequestsSaid => {
  if (node === undefined || !CODE_TYPES.has(node.type)) return {};
  return landingsOf(db, requestNodesOf(db, node));
};

/**
 * Where each of `requests` lands (P404): the rows `requestsOf` says of a
 * method's requests, said of any list of request nodes - the ones a
 * `get_flow` walk crossed.
 */
export const landingsOf = (db: GraphDb, requests: readonly GraphNode[]): RequestsSaid => {
  if (requests.length === 0) return {};
  const landed: RequestLanding[] = [];
  const unjoined: string[] = [];
  for (const request of requests) {
    const routes = db.edgesFrom(request.id, [...REQUEST_EDGES]).map((edge) => edge.to);
    if (routes.length === 0) {
      const said = unjoinedSaid(request);
      if (!unjoined.includes(said)) unjoined.push(said);
      continue;
    }
    for (const route of routes) {
      if (landed.some((row) => row.route === route)) continue;
      const by = handlerOf(db, route);
      landed.push({ route, ...(by === undefined ? {} : { by }) });
    }
  }
  const listed = landed.slice(0, MOST_REQUESTS);
  const unjoinedListed = unjoined.slice(0, Math.max(0, MOST_REQUESTS - listed.length));
  const more = landed.length + unjoined.length - listed.length - unjoinedListed.length;
  const rows: Array<RequestLanding | RequestUnjoined | RequestsMore> = [
    ...listed,
    ...unjoinedListed.map((said) => ({ unjoined: said })),
    ...(more > 0 ? [{ more }] : []),
  ];
  return rows.length === 0 ? {} : { requests: rows };
};
