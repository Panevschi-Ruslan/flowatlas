import {
  CHANNEL_FORWARD_META,
  CHANNEL_PATTERN_META,
  forwardedName,
  makeChannelId,
  matchChannelPattern,
  type ChannelForward,
  type ChannelPattern,
  type GraphEdge,
  type GraphNode,
  type PatternMatch,
  type Unresolved,
} from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Joins a consumer that takes its channels by a filter to every channel the
 * filter selects (P23).
 *
 * A rule on an event bus is a filter, not a name: it takes every event whose
 * source starts with `library.`, or every detail type of one source. Its
 * channels are therefore whichever channels the project's publishers name,
 * which only the whole project knows. Each channel whose name the filter
 * matches gets a `consumes` edge, `static` only where every part matched an
 * exact value - the same join two names make - and `heuristic` otherwise, with
 * the reason on the edge. A filter that selects nothing anybody publishes is
 * a way in from outside the project, not a fault: one `info` row says so.
 *
 * A consumer that carries what it takes on to other channels - a rule whose
 * target is another bus - has its publisher put each matched channel onto the
 * channel its forward renames it to (R174). Those channels are new to the
 * project, and a filter on the other bus may select them, so matching is
 * repeated over each round's new channels until a round adds none. It ends:
 * a forward only renames parts of a name, and there are as many names as there
 * are combinations of the parts the project already spells.
 */

const CHANNEL_PREFIX = 'channel:';

const nameOf = (channel: GraphNode): string => channel.id.slice(CHANNEL_PREFIX.length);

/** How far an edge resting on a match can be trusted, and what it says about why. */
const footing = (match: PatternMatch, consumer: GraphNode): Pick<GraphEdge, 'confidence'> & { because: string[] } => {
  const disabled = consumer.meta?.['disabled'] === true;
  const because = [...match.because, ...(disabled ? ['the delivery is disabled'] : [])];
  return { confidence: match.exact && !disabled ? 'static' : 'heuristic', because };
};

const at = (node: GraphNode): Pick<GraphEdge, 'file' | 'line'> => ({
  ...(node.file === undefined ? {} : { file: node.file }),
  ...(node.line === undefined ? {} : { line: node.line }),
});

const addEdge = (edges: Map<string, GraphEdge>, edge: GraphEdge): void => {
  if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
};

/**
 * The channel a forward carries a matched channel onto, drawn where the
 * project does not draw it yet, and the publisher's edge onto it. Returns the
 * channel when it is new.
 */
const carryOn = (
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  consumer: GraphNode,
  channel: GraphNode,
  match: PatternMatch,
): GraphNode | undefined => {
  const forward = consumer.meta?.[CHANNEL_FORWARD_META] as ChannelForward | undefined;
  const producer = forward === undefined ? undefined : nodes.get(forward.producer);
  const name = forward === undefined ? undefined : forwardedName(nameOf(channel), forward);
  if (forward === undefined || producer === undefined || name === undefined) return undefined;
  const id = makeChannelId(name);
  const existing = nodes.get(id);
  const created: GraphNode | undefined =
    existing === undefined ? { ...channel, id, label: name, repo: producer.repo, ...at(producer) } : undefined;
  if (created !== undefined) nodes.set(id, created);
  const { confidence, because } = footing(match, consumer);
  addEdge(edges, {
    from: producer.id,
    to: id,
    type: 'emits',
    confidence,
    ...at(consumer),
    meta: { via: 'pattern', forwardedFrom: channel.id, ...(because.length === 0 ? {} : { because }) },
  });
  return created;
};

export const joinChannelPatterns = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const consumers = [...nodes.values()]
    .filter((node) => node.type === 'consumer' && node.meta?.[CHANNEL_PATTERN_META] !== undefined)
    .sort((a, b) => cmp(a.id, b.id));
  const matched = new Map<string, number>();
  let fresh = [...nodes.values()].filter((node) => node.type === 'channel').sort((a, b) => cmp(a.id, b.id));
  while (fresh.length > 0) {
    const created: GraphNode[] = [];
    for (const consumer of consumers) {
      const pattern = consumer.meta?.[CHANNEL_PATTERN_META] as ChannelPattern;
      const skipped = consumer.meta?.['notMatchedOn'];
      for (const channel of fresh) {
        const match = matchChannelPattern(nameOf(channel), pattern);
        if (match === undefined) continue;
        matched.set(consumer.id, (matched.get(consumer.id) ?? 0) + 1);
        const { confidence, because } = footing(match, consumer);
        addEdge(edges, {
          from: channel.id,
          to: consumer.id,
          type: 'consumes',
          confidence,
          ...at(consumer),
          meta: {
            via: 'pattern',
            ...(because.length === 0 ? {} : { because }),
            ...(Array.isArray(skipped) && skipped.length > 0 ? { notMatchedOn: skipped } : {}),
          },
        });
        const carried = carryOn(nodes, edges, consumer, channel, match);
        if (carried !== undefined) created.push(carried);
      }
    }
    fresh = created.sort((a, b) => cmp(a.id, b.id));
  }
  return consumers
    .filter((consumer) => !matched.has(consumer.id))
    .map((consumer): Unresolved => ({
      service: consumer.repo,
      file: consumer.file ?? '',
      line: consumer.line ?? 0,
      reason: 'subscription-matches-nothing',
      level: 'info',
      message: `${consumer.label} takes events by a pattern that no publisher in the configured services matches`,
      hint: 'A rule for events nothing here puts is a way in from outside - another account, a partner, the platform itself - or its publisher is in a repository the configuration does not name. Nothing to fix if it is the first.',
      symbol: consumer.id,
    }));
};
