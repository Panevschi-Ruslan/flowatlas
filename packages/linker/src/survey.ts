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

/** The strings of a list kept on a node's meta, or none. */
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * The files that answer a request reaching a procedure or its route (P58): the
 * mounts of the protocol the caller's link speaks, where the procedure says
 * where it is mounted with it, and otherwise every file that serves it.
 */
const filesAnswering = (caller: GraphNode | undefined, reached: GraphNode): string[] => {
  const isProcedure = typeof reached.meta?.['key'] === 'string' && typeof reached.meta?.['call'] === 'string';
  if (!isProcedure && typeof reached.meta?.['procedure'] !== 'string') return [];
  const link = caller?.meta?.['link'];
  const protocol = link !== null && typeof link === 'object' ? (link as Record<string, unknown>)['protocol'] : undefined;
  const mounted = Array.isArray(reached.meta?.['mounted'])
    ? (reached.meta['mounted'] as Array<Record<string, unknown>>).filter((mount) => mount['protocol'] === protocol)
    : [];
  return mounted.length > 0 ? mounted.flatMap((mount) => stringsOf([mount['file']])) : stringsOf(reached.meta?.['served']);
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
  const edgeList = [...edges];
  for (const edge of edgeList) {
    if (edge.type === 'http_calls' || edge.type === 'hits') called.add(edge.to);
    if (edge.type === 'handles') handlersOf.set(edge.from, (handlersOf.get(edge.from) ?? 0) + 1);
  }

  const all = [...nodes];
  const routes = all.filter((node) => node.type === 'entry' && node.kind === 'http');
  // A route that also answers for a procedure is called when the procedure is,
  // and the other way round: a client asking by the path and one asking by the
  // route reach the same code, and either one keeps it alive (P58).
  const procedures = new Map<string, string[]>();
  for (const node of all) {
    const named = node.type === 'entry' ? node.meta?.['procedure'] : undefined;
    if (typeof named !== 'string') continue;
    const key = `${node.repo}\0${named}`;
    procedures.set(key, [...(procedures.get(key) ?? []), node.id]);
  }
  for (const node of all) {
    if (node.type !== 'entry' || node.kind === 'http' || typeof node.meta?.['key'] !== 'string') continue;
    const twins = procedures.get(`${node.repo}\0${node.meta['key'] as string}`) ?? [];
    if (twins.length === 0) continue;
    if (called.has(node.id) || twins.some((twin) => called.has(twin))) {
      called.add(node.id);
      for (const twin of twins) called.add(twin);
    }
  }
  // The file a tree of procedures is mounted in answers every request for one
  // of them that crosses the network, at whatever route the file itself is: a
  // client asking for a procedure is asking that file (P58). Only the mounts
  // of the protocol the client speaks, where both say which.
  const byId = new Map(all.map((node) => [node.id, node]));
  const mountFiles = new Set<string>();
  for (const edge of edgeList) {
    if (edge.type !== 'http_calls' && edge.type !== 'hits') continue;
    const caller = byId.get(edge.from);
    const reached = byId.get(edge.to);
    if (reached === undefined || caller?.meta?.['inProcess'] === true) continue;
    for (const file of filesAnswering(caller, reached)) mountFiles.add(`${reached.repo}\0${file}`);
  }
  for (const route of all) {
    if (route.type !== 'entry' || route.kind !== 'http' || typeof route.meta?.['procedure'] === 'string') continue;
    // Only a route that can answer under the tree's paths - its last segment a
    // hole, as a file-system router's catch-all is - and not every route that
    // happens to be declared in the same file as the mount.
    const path = typeof route.meta?.['path'] === 'string' ? (route.meta['path'] as string) : '';
    const last = path.slice(path.lastIndexOf('/') + 1);
    if (last !== '*' && !last.startsWith(':')) continue;
    if (route.file !== undefined && mountFiles.has(`${route.repo}\0${route.file}`)) called.add(route.id);
  }
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
