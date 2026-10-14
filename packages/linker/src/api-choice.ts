import type { GraphNode } from '@flowatlas/core';

/**
 * Which of several APIs serving one method and path a request means (P59).
 *
 * Two APIs (or two load balancers) of one deployment may serve the same method
 * and path, each in front of its own function, and are kept apart as two
 * entries. A request reaching them by a base URL setting carries nothing that
 * names the API but the setting's own name, so the name is what is compared:
 * `BILLING_API_URL` means the API called `billing-api` over `orders-api`. That
 * is a guess and is joined as one; where the name settles nothing, nothing is
 * chosen and the APIs are named instead.
 *
 * An API with more than one route at the address - one load balancer's
 * listeners sending it to different functions (P61) - can still be the one
 * the name points at; the request is then narrowed to that API's routes,
 * which nothing more in the name tells apart.
 */
export type ApiChoice =
  | { kind: 'none' }
  | { kind: 'one'; entry: GraphNode; api: string; apis: readonly string[] }
  | { kind: 'tie'; apis: readonly string[] }
  | { kind: 'narrowed'; entries: readonly GraphNode[]; api: string };

/** Words every such name has, which say nothing about which API it is. */
const GENERIC = new Set([
  'api', 'apis', 'url', 'uri', 'base', 'endpoint', 'host', 'http', 'https', 'gateway', 'lb', 'alb', 'elb', 'balancer', 'load', 'service', 'svc',
  // The words of a declaration's type, which an API is named by where its own name is not read (P61).
  'aws', 'apigatewayv2', 'rest', 'v2',
]);

/** The words of a name, however it is spelled: `BILLING_API_URL`, `billing-api`, `billingApi`. */
export const wordsOf = (name: string): Set<string> =>
  new Set(
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '' && !GENERIC.has(word)),
  );

/** The API's name, else its declaration's address: `aws_apigatewayv2_api.loans` reads as `loans` (P61). */
const apiOf = (entry: GraphNode): string | undefined => {
  const api = entry.meta?.['api'] ?? entry.meta?.['apiAddress'];
  return typeof api === 'string' ? api : undefined;
};

/** How many words of the API's name the setting's name shares. */
const scoreOf = (api: string, asked: ReadonlySet<string>): number => [...wordsOf(api)].filter((word) => asked.has(word)).length;

/**
 * The candidate the setting's name points at, when the candidates are each
 * of an API and exactly one API shares the most words with it.
 */
export const chooseByApiName = (candidates: readonly GraphNode[], setting: string): ApiChoice => {
  const byApi = new Map<string, GraphNode[]>();
  for (const entry of candidates) {
    const api = apiOf(entry);
    if (api === undefined) return { kind: 'none' };
    byApi.set(api, [...(byApi.get(api) ?? []), entry]);
  }
  const apis = [...byApi.keys()].sort();
  if (apis.length < 2) return { kind: 'none' };
  const asked = wordsOf(setting);
  const scores = apis.map((api) => scoreOf(api, asked));
  const best = Math.max(...scores);
  const winners = apis.filter((_, index) => scores[index] === best);
  if (best === 0 || winners.length > 1) return { kind: 'tie', apis };
  const api = winners[0] as string;
  const entries = byApi.get(api) as GraphNode[];
  if (entries.length > 1) return { kind: 'narrowed', entries, api };
  return { kind: 'one', entry: entries[0] as GraphNode, api, apis };
};
