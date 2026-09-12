import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { cmp } from './order.js';

export interface ChannelSurvey {
  total: number;
  linked: number;
  noConsumers: string[];
  noProducers: string[];
}

export interface RouteSurvey {
  total: number;
  called: number;
  uncalled: string[];
  duplicated: string[];
}

const tally = (edges: Iterable<GraphEdge>, type: string, end: 'from' | 'to'): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type !== type) continue;
    const id = edge[end];
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
};

/**
 * Counts what each channel has at either end.
 *
 * Writes the two counts onto the channel so a later query does not have to
 * walk the edges again, and reports the one-sided ones. A channel with
 * publishers and no handlers is not an error: the handler may live in a
 * repository the configuration does not name yet.
 */
export const surveyChannels = (
  nodes: Iterable<GraphNode>,
  edges: Iterable<GraphEdge>,
): ChannelSurvey => {
  const all = [...edges];
  const producersOf = tally(all, 'emits', 'to');
  const consumersOf = tally(all, 'consumes', 'from');

  const noConsumers: string[] = [];
  const noProducers: string[] = [];
  let linked = 0;
  let total = 0;

  for (const channel of nodes) {
    if (channel.type !== 'channel') continue;
    total += 1;
    const producers = producersOf.get(channel.id) ?? 0;
    const consumers = consumersOf.get(channel.id) ?? 0;
    channel.meta = { ...channel.meta, producers, consumers };
    if (producers > 0 && consumers > 0) linked += 1;
    if (consumers === 0) noConsumers.push(channel.id);
    if (producers === 0) noProducers.push(channel.id);
  }

  return { total, linked, noConsumers: noConsumers.sort(cmp), noProducers: noProducers.sort(cmp) };
};

/**
 * Looks at every route from the outside.
 *
 * Two questions worth asking of a route once every repository is present: does
 * anything reach it, and does more than one handler claim it. One address with
 * two handlers means the framework answers with whichever it registered first
 * and the other is dead code that still type-checks.
 */
export const surveyRoutes = (
  nodes: Iterable<GraphNode>,
  edges: Iterable<GraphEdge>,
): RouteSurvey => {
  const called = new Set<string>();
  const handlersOf = new Map<string, number>();
  for (const edge of edges) {
    if (edge.type === 'http_calls' || edge.type === 'hits') called.add(edge.to);
    if (edge.type === 'handles') handlersOf.set(edge.from, (handlersOf.get(edge.from) ?? 0) + 1);
  }

  const routes = [...nodes].filter((node) => node.type === 'entry' && node.kind === 'http');
  const uncalled = routes
    .filter((route) => !called.has(route.id))
    .map((route) => route.id)
    .sort(cmp);
  const duplicated = routes
    .filter((route) => (handlersOf.get(route.id) ?? 0) > 1)
    .map((route) => route.id)
    .sort(cmp);

  return { total: routes.length, called: routes.length - uncalled.length, uncalled, duplicated };
};
