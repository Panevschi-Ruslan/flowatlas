import { EVERY_CHANNEL_META, isMessageTypeNode, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { cmp, edgeKey } from './order.js';

/**
 * Joins a consumer that subscribes to every channel of a bus at once (P369)
 * to each channel that bus carries.
 *
 * A project's own bus is usually in-process: a subject every publish writes
 * to, which hands each subscriber the frames of one channel - or, through a
 * call that names none (`bus.all().subscribe(…)`), the frames of every
 * channel. The reader drew such a subscriber with the bus's name and no
 * channel, because which channels the bus carries is only known once every
 * publish through it has been read. Here they are: every channel a publish
 * through that bus, in the same service, writes to. Each gets a `consumes`
 * edge, `static` - the bus hands the subscriber every frame it carries - with
 * `via: every-channel`. The types the subscriber chooses are drawn on each of
 * them by the message types' join, as for any consumer.
 *
 * A subscriber whose bus carries nothing read is one `info` row.
 */
export const joinEveryChannel = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const subscribers = [...nodes.values()]
    .filter((node) => node.type === 'consumer' && typeof node.meta?.[EVERY_CHANNEL_META] === 'string')
    .sort((a, b) => cmp(a.id, b.id));
  if (subscribers.length === 0) return [];
  // The channels each bus carries, by service: where its publishes write.
  const carried = new Map<string, Set<string>>();
  for (const edge of edges.values()) {
    if (edge.type !== 'emits') continue;
    const producer = nodes.get(edge.from);
    const channel = nodes.get(edge.to);
    const adapter = producer?.meta?.['adapter'];
    if (producer?.type !== 'producer' || typeof adapter !== 'string' || channel?.type !== 'channel' || isMessageTypeNode(channel)) continue;
    const key = `${producer.repo}\u0000${adapter}`;
    const set = carried.get(key) ?? new Set<string>();
    set.add(channel.id);
    carried.set(key, set);
  }
  const rows: Unresolved[] = [];
  for (const subscriber of subscribers) {
    const bus = subscriber.meta?.[EVERY_CHANNEL_META] as string;
    const channels = [...(carried.get(`${subscriber.repo}\u0000${bus}`) ?? [])].sort(cmp);
    if (channels.length === 0) {
      rows.push({
        service: subscriber.repo,
        file: subscriber.file ?? '',
        line: subscriber.line ?? 0,
        reason: 'subscription-matches-nothing',
        level: 'info',
        message: `${subscriber.label} subscribes to every channel of ${bus}, and no publish through ${bus} in ${subscriber.repo} was read`,
        hint: 'The bus hands it every message published through it in this service; none of those publishes was read, so it is joined to no channel. Nothing to fix if the bus carries messages from outside the code read here.',
        symbol: subscriber.id,
      });
      continue;
    }
    for (const channel of channels) {
      const edge: GraphEdge = {
        from: channel,
        to: subscriber.id,
        type: 'consumes',
        confidence: 'static',
        ...(subscriber.file === undefined ? {} : { file: subscriber.file }),
        ...(subscriber.line === undefined ? {} : { line: subscriber.line }),
        meta: { via: 'every-channel' },
      };
      if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
    }
  }
  return rows;
};
