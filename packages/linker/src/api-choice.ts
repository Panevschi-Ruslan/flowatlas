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
 */
export type ApiChoice =
  | { kind: 'none' }
  | { kind: 'one'; entry: GraphNode; api: string; apis: readonly string[] }
  | { kind: 'tie'; apis: readonly string[] };

/** Words every such name has, which say nothing about which API it is. */
const GENERIC = new Set(['api', 'apis', 'url', 'uri', 'base', 'endpoint', 'host', 'http', 'https', 'gateway', 'lb', 'alb', 'elb', 'balancer', 'load', 'service', 'svc']);

/** The words of a name, however it is spelled: `BILLING_API_URL`, `billing-api`, `billingApi`. */
export const wordsOf = (name: string): Set<string> =>
  new Set(
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '' && !GENERIC.has(word)),
  );

const apiOf = (entry: GraphNode): string | undefined => {
  const api = entry.meta?.['api'];
  return typeof api === 'string' ? api : undefined;
};

/** How many words of the API's name the setting's name shares. */
const scoreOf = (api: string, asked: ReadonlySet<string>): number => [...wordsOf(api)].filter((word) => asked.has(word)).length;

/**
 * The candidate the setting's name points at, when the candidates are one
 * route per API and exactly one API shares the most words with it.
 */
export const chooseByApiName = (candidates: readonly GraphNode[], setting: string): ApiChoice => {
  const byApi = new Map<string, GraphNode[]>();
  for (const entry of candidates) {
    const api = apiOf(entry);
    if (api === undefined) return { kind: 'none' };
    byApi.set(api, [...(byApi.get(api) ?? []), entry]);
  }
  const apis = [...byApi.keys()].sort();
  if (apis.length < 2 || [...byApi.values()].some((entries) => entries.length > 1)) return { kind: 'none' };
  const asked = wordsOf(setting);
  const scores = apis.map((api) => scoreOf(api, asked));
  const best = Math.max(...scores);
  const winners = apis.filter((_, index) => scores[index] === best);
  if (best === 0 || winners.length > 1) return { kind: 'tie', apis };
  const api = winners[0] as string;
  return { kind: 'one', entry: (byApi.get(api) as GraphNode[])[0] as GraphNode, api, apis };
};
