import { CONFIDENCE_RANK, STREAM_KIND, type Confidence, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Channels handed on through a stream of server-sent events (P359).
 *
 * Each half is read where it is written. A server's reader marks a route whose
 * handler streams a channel it subscribes to: a `consumer` the channel
 * `consumes` into, with `meta.relay` naming the route. A screen's reader
 * records the stream's request, which the linker joins to the route (`hits`),
 * and the function its frames arrive at: a `consumer` the request `triggers`.
 * Only here are both in one graph, so this is where a channel the route relays
 * reaches the screen: an edge `channel -consumes-> screen consumer` per channel,
 * per route, with the route and the request on the edge. `who_consumes` on the
 * channel then names the route and every screen fed by it, and a walk from the
 * publisher runs through to the screen's handler.
 *
 * A stream a browser holds open on a route that relays nothing read is a row on
 * the route - naming the per-scope object the route hands its request to, where
 * its class was not read (P361) - unless the server's reader saw the stream and wrote one there
 * itself; a request that joined no route was already counted as one by the
 * request join.
 */

const weakest = (...levels: readonly Confidence[]): Confidence =>
  levels.reduce((low, level) => (CONFIDENCE_RANK[level] < CONFIDENCE_RANK[low] ? level : low), 'static' as Confidence);

const push = <V>(index: Map<string, V[]>, key: string, value: V): void => {
  const list = index.get(key);
  if (list === undefined) index.set(key, [value]);
  else list.push(value);
};

export const joinStreamRelays = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const relaysOf = new Map<string, GraphNode[]>();
  for (const node of nodes.values()) {
    const relay = node.meta?.['relay'];
    if (node.type === 'consumer' && typeof relay === 'string') push(relaysOf, relay, node);
  }
  const hitsFrom = new Map<string, GraphEdge[]>();
  const triggersFrom = new Map<string, GraphEdge[]>();
  const consumesTo = new Map<string, GraphEdge[]>();
  for (const edge of edges.values()) {
    if (edge.type === 'hits') push(hitsFrom, edge.from, edge);
    else if (edge.type === 'triggers') push(triggersFrom, edge.from, edge);
    else if (edge.type === 'consumes') push(consumesTo, edge.to, edge);
  }

  const unrelayed = new Map<string, GraphNode>();
  const calls = [...nodes.values()].filter((node) => node.type === 'ui_api_call' && node.kind === STREAM_KIND).sort((a, b) => cmp(a.id, b.id));
  for (const call of calls) {
    const screens = (triggersFrom.get(call.id) ?? []).filter((edge) => nodes.get(edge.to)?.type === 'consumer');
    for (const hit of hitsFrom.get(call.id) ?? []) {
      const route = nodes.get(hit.to);
      if (route === undefined) continue;
      const relays = relaysOf.get(route.id) ?? [];
      if (relays.length === 0) {
        unrelayed.set(route.id, route);
        continue;
      }
      for (const relay of relays) {
        for (const consumed of consumesTo.get(relay.id) ?? []) {
          for (const trigger of screens) {
            const screen = nodes.get(trigger.to) as GraphNode;
            const edge: GraphEdge = {
              from: consumed.from,
              to: screen.id,
              type: 'consumes',
              confidence: weakest(consumed.confidence, hit.confidence, trigger.confidence),
              ...(trigger.file === undefined ? {} : { file: trigger.file }),
              ...(trigger.line === undefined ? {} : { line: trigger.line }),
              meta: { via: STREAM_KIND, route: route.id, call: call.id },
            };
            const key = edgeKey(edge);
            const existing = edges.get(key);
            if (existing === undefined) edges.set(key, edge);
            else if (CONFIDENCE_RANK[edge.confidence] > CONFIDENCE_RANK[existing.confidence]) existing.confidence = edge.confidence;
            const routes = Array.isArray(screen.meta?.['routes']) ? (screen.meta?.['routes'] as string[]) : [];
            if (!routes.includes(route.id)) screen.meta = { ...screen.meta, routes: [...routes, route.id].sort(cmp) };
          }
        }
      }
    }
  }

  const rows: Unresolved[] = [];
  for (const route of [...unrelayed.values()].sort((a, b) => cmp(a.id, b.id))) {
    // The server's reader saw the stream, found nothing relayed, and said so where it is answered.
    if (route.meta?.['stream'] === STREAM_KIND) continue;
    // The route hands its request to a per-scope object whose class the
    // server's reader could not read (P361): the stream is answered there.
    const handedTo = Array.isArray(route.meta?.['handedTo']) ? (route.meta?.['handedTo'] as { why?: unknown; hint?: unknown }[]) : [];
    const [handed] = handedTo;
    if (handed !== undefined && typeof handed.why === 'string') {
      rows.push({
        service: route.repo,
        file: route.file ?? '',
        line: route.line ?? 0,
        reason: 'stream-relay-unread',
        level: 'info',
        message: `A browser holds this route open as a stream of server-sent events, and the route hands its request to a per-scope object whose class is not read: ${handed.why}.`,
        hint: typeof handed.hint === 'string' ? handed.hint : 'Annotate the handler with @Consumes(\'<channel>\').',
        symbol: route.label,
      });
      continue;
    }
    rows.push({
      service: route.repo,
      file: route.file ?? '',
      line: route.line ?? 0,
      reason: 'stream-relay-unread',
      level: 'info',
      message: 'A browser holds this route open as a stream of server-sent events, and nothing in the code behind it was read as relaying a channel onto it.',
      hint: 'Where the stream is answered by code of the route\'s own, subscribe there with a client a broker description reads; or annotate the handler with @Consumes(\'<channel>\').',
      symbol: route.label,
    });
  }
  return rows;
};
