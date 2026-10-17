/**
 * The joins one revision made and the next does not (P96).
 *
 * A diff of nodes and edges says a route went away; it does not say who was
 * still asking for it. That is the question a reviewer has, and the answer is
 * read from the end that is left behind: a request that joined a route on the
 * base side and joins nothing on the head side, a channel whose consumers are
 * still listening after its last producer went, or one still published after
 * its last consumer went.
 *
 * Pure, two graphs in and a list out, so `flowatlas diff` stores it in
 * `diff.json` once and P117's check against a deployed graph calls the same
 * function on its own two sides.
 */
import { kindOfRow, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import type { LostJoin } from './types.js';

/** As much of a graph as this reads. */
export type JoinGraph = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  unresolved: readonly Unresolved[];
};

/** The edges a request joins its route by: between services, and from a browser. */
export const REQUEST_JOIN_EDGES: readonly string[] = ['http_calls', 'hits'];

/** What a head side with no row about a caller is said to say. */
export const NO_EDGE = 'no-edge';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const order = (a: LostJoin, b: LostJoin): number =>
  byText(a.kind, b.kind) || byText(a.caller, b.caller) || byText(a.target, b.target);

/** Edges of these types, by the node they leave. */
const edgesByFrom = (edges: readonly GraphEdge[], types: readonly string[]): Map<string, GraphEdge[]> => {
  const found = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (!types.includes(edge.type)) continue;
    found.set(edge.from, [...(found.get(edge.from) ?? []), edge]);
  }
  return found;
};

/** Each channel's producers (`emits` into it) and consumers (`consumes` out of it). */
const channelEnds = (graph: JoinGraph): Map<string, { producers: Set<string>; consumers: Set<string> }> => {
  const ends = new Map<string, { producers: Set<string>; consumers: Set<string> }>();
  const channels = new Set(graph.nodes.filter((node) => node.type === 'channel').map((node) => node.id));
  const at = (id: string): { producers: Set<string>; consumers: Set<string> } => {
    let found = ends.get(id);
    if (found === undefined) {
      found = { producers: new Set(), consumers: new Set() };
      ends.set(id, found);
    }
    return found;
  };
  for (const edge of graph.edges) {
    if (edge.type === 'emits' && channels.has(edge.to)) at(edge.to).producers.add(edge.from);
    else if (edge.type === 'consumes' && channels.has(edge.from)) at(edge.from).consumers.add(edge.to);
  }
  return ends;
};

/**
 * Requests that joined on the base side and join nothing on the head side.
 *
 * Only a request still in the head graph: one removed with its method went
 * with what called it, and nobody is left to notice. A request that joins
 * some other route now was retargeted, which is a change and not a loss.
 */
const lostRequests = (base: JoinGraph, head: JoinGraph): LostJoin[] => {
  const before = edgesByFrom(base.edges, REQUEST_JOIN_EDGES);
  const after = edgesByFrom(head.edges, REQUEST_JOIN_EDGES);
  const headNodes = new Map(head.nodes.map((node) => [node.id, node]));
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  // What the head side wrote about the caller instead: a gap or a finding
  // before a note, which says how a join was made rather than why none was.
  const said = new Map<string, string>();
  for (const row of [...head.unresolved].sort((a, b) => Number(kindOfRow(a) === 'note') - Number(kindOfRow(b) === 'note'))) {
    if (row.symbol !== undefined && !said.has(row.symbol)) said.set(row.symbol, row.reason);
  }
  const lost: LostJoin[] = [];
  for (const [caller, edges] of before) {
    const still = headNodes.get(caller);
    if (still === undefined || (after.get(caller)?.length ?? 0) > 0) continue;
    for (const edge of edges) {
      lost.push({
        kind: 'target-gone',
        caller,
        target: edge.to,
        edge: edge.type,
        service: still.repo,
        targetService: baseNodes.get(edge.to)?.repo ?? null,
        now: said.get(caller) ?? NO_EDGE,
        targetRemoved: !headNodes.has(edge.to),
      });
    }
  }
  return lost;
};

/**
 * Channels that had both ends on the base side and only one on the head side,
 * one row per end left behind. A channel with neither end left went away
 * whole, with nobody left to notice.
 */
const lostChannelEnds = (base: JoinGraph, head: JoinGraph): LostJoin[] => {
  const before = channelEnds(base);
  const after = channelEnds(head);
  const headNodes = new Map(head.nodes.map((node) => [node.id, node]));
  const lost: LostJoin[] = [];
  for (const [channel, was] of before) {
    if (was.producers.size === 0 || was.consumers.size === 0) continue;
    const now = after.get(channel) ?? { producers: new Set<string>(), consumers: new Set<string>() };
    const left = (ids: Set<string>, kind: LostJoin['kind'], edge: string): void => {
      for (const id of [...ids].sort(byText)) {
        lost.push({
          kind,
          caller: id,
          target: channel,
          edge,
          service: headNodes.get(id)?.repo ?? '',
          targetService: null,
          now: kind,
          targetRemoved: !headNodes.has(channel),
        });
      }
    };
    if (now.producers.size === 0 && now.consumers.size > 0) left(now.consumers, 'no-producer', 'consumes');
    else if (now.consumers.size === 0 && now.producers.size > 0) left(now.producers, 'no-consumer', 'emits');
  }
  return lost;
};

/** Every join the base side made that the head side does not, by kind, then caller, then target. */
export const lostJoins = (base: JoinGraph, head: JoinGraph): LostJoin[] =>
  [...lostRequests(base, head), ...lostChannelEnds(base, head)].sort(order);
