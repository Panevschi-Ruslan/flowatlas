import {
  DISCRIMINATOR_META,
  isMessageTypeNode,
  makeMessageTypeId,
  MESSAGE_TYPE_KIND,
  MESSAGE_TYPE_UNREAD_META,
  messageTypesOf,
  selectionsOf,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { messageTypeFacts, unselectedSaid, type MessageTypeLookup } from './analysis/message-types.js';
import { cmp, edgeKey } from './order.js';

/**
 * Draws the types of message each channel carries (P358), once the whole
 * project is here.
 *
 * Each repository's reader recorded what it read where it read it: the type a
 * publish writes, on its producer, and the types a consumer's handler chooses
 * on, on its consumer. Which channel either is on is only settled here - a
 * channel joined across repositories, a pattern matched against every channel,
 * a stream a browser holds open - so the types are drawn here too: a type node
 * per channel and value, every publish of it `emits` to it, every handler
 * that selects it `consumes` from it. The parent channel's own edges stay as
 * they were.
 *
 * A type published on a channel whose consumers choose by type, and chosen by
 * none of them, is a finding: the design says each type has its handler, and
 * this one has none.
 */
export const joinMessageTypes = (nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): Unresolved[] => {
  const from = new Map<string, GraphEdge[]>();
  const to = new Map<string, GraphEdge[]>();
  const index = (edge: GraphEdge): void => {
    from.set(edge.from, [...(from.get(edge.from) ?? []), edge]);
    to.set(edge.to, [...(to.get(edge.to) ?? []), edge]);
  };
  for (const edge of edges.values()) index(edge);
  const add = (edge: GraphEdge): void => {
    const key = edgeKey(edge);
    if (edges.has(key)) return;
    edges.set(key, edge);
    index(edge);
  };

  const channelOf = (id: string): GraphNode | undefined => {
    const node = nodes.get(id);
    return node?.type === 'channel' && !isMessageTypeNode(node) ? node : undefined;
  };
  const typeNode = (channel: GraphNode, value: string, discriminator: unknown, at: GraphNode): GraphNode => {
    const id = makeMessageTypeId(channel.id, value);
    const existing = nodes.get(id);
    if (existing !== undefined) return existing;
    const node: GraphNode = {
      id,
      type: 'channel',
      label: `${channel.label}#${value}`,
      repo: at.repo,
      ...(at.file === undefined ? {} : { file: at.file }),
      ...(at.line === undefined ? {} : { line: at.line }),
      kind: MESSAGE_TYPE_KIND,
      meta: {
        channel: channel.id,
        messageType: value,
        ...(typeof discriminator === 'string' ? { [DISCRIMINATOR_META]: discriminator } : {}),
        ...(channel.meta?.['channelKind'] === undefined ? {} : { channelKind: channel.meta['channelKind'] }),
      },
    };
    nodes.set(id, node);
    return node;
  };

  const sorted = [...nodes.values()].sort((a, b) => cmp(a.id, b.id));
  for (const producer of sorted) {
    if (producer.type !== 'producer') continue;
    const types = messageTypesOf(producer);
    if (types.length === 0) continue;
    for (const edge of from.get(producer.id) ?? []) {
      if (edge.type !== 'emits') continue;
      const channel = channelOf(edge.to);
      if (channel === undefined) continue;
      for (const value of types) {
        const type = typeNode(channel, value, producer.meta?.[DISCRIMINATOR_META], producer);
        add({
          from: producer.id,
          to: type.id,
          type: 'emits',
          confidence: edge.confidence,
          ...(edge.file === undefined ? {} : { file: edge.file }),
          ...(edge.line === undefined ? {} : { line: edge.line }),
          ...(edge.params === undefined ? {} : { params: [...edge.params] }),
          ...(edge.returns === undefined ? {} : { returns: edge.returns }),
          ...(edge.meta?.['because'] === undefined ? {} : { meta: { because: edge.meta['because'] } }),
        });
      }
    }
  }
  // A per-scope hub's own channel that is handed other channels by name stands
  // for their messages (P362): where nothing written to it says a type, the
  // types its screens choose are drawn on those channels, not on it.
  const typed = (channel: GraphNode): boolean =>
    !Array.isArray(channel.meta?.['forwards']) ||
    (to.get(channel.id) ?? []).some((edge) => edge.type === 'emits' && messageTypesOf(nodes.get(edge.from)).length > 0);
  /**
   * What the publishes on a channel say of the types it carries (P362): the
   * types read, and whether any publish's type was not read. A consumer joined
   * to several channels through one stream selects a type on each only where
   * it may be there: a channel whose publishes include it, or one with a
   * publish whose type was not read (a guess); a channel none of whose
   * publishes were read for a type keeps every type selected on it.
   */
  const published = new Map<string, { types: Set<string>; unread: boolean }>();
  const publishedOn = (channelId: string): { types: Set<string>; unread: boolean } => {
    const known = published.get(channelId);
    if (known !== undefined) return known;
    const types = new Set<string>();
    let unread = false;
    for (const edge of to.get(channelId) ?? []) {
      if (edge.type !== 'emits') continue;
      const producer = nodes.get(edge.from);
      for (const value of messageTypesOf(producer)) types.add(value);
      if (typeof producer?.meta?.[MESSAGE_TYPE_UNREAD_META] === 'string') unread = true;
    }
    const made = { types, unread };
    published.set(channelId, made);
    return made;
  };
  for (const consumer of sorted) {
    if (consumer.type !== 'consumer') continue;
    const selections = selectionsOf(consumer);
    if (selections.length === 0) continue;
    for (const edge of to.get(consumer.id) ?? []) {
      if (edge.type !== 'consumes') continue;
      const channel = channelOf(edge.from);
      if (channel === undefined || !typed(channel)) continue;
      const carried = publishedOn(channel.id);
      for (const selection of selections) {
        if (!nodes.has(selection.consumer)) continue;
        const read = carried.types.size === 0 || carried.types.has(selection.type);
        if (!read && !carried.unread) continue;
        const type = typeNode(channel, selection.type, consumer.meta?.[DISCRIMINATOR_META], consumer);
        add({
          from: type.id,
          to: selection.consumer,
          type: 'consumes',
          confidence: selection.heuristic === true || !read ? 'heuristic' : edge.confidence,
          file: selection.file ?? consumer.file ?? '',
          line: selection.line,
          meta: { selectedBy: consumer.id, via: selection.via },
        });
      }
    }
  }

  // The finding, asked the way `dead` and the server ask it.
  const lookup: MessageTypeLookup = {
    node: (id) => nodes.get(id),
    edgesFrom: (id, types) => (from.get(id) ?? []).filter((edge) => types === undefined || types.includes(edge.type)),
    edgesTo: (id, types) => (to.get(id) ?? []).filter((edge) => types === undefined || types.includes(edge.type)),
    nodesByType: (type) => [...nodes.values()].filter((node) => node.type === type),
  };
  const modules = new Set(lookup.nodesByType('module').map((node) => node.repo));
  const rows: Unresolved[] = [];
  for (const type of [...nodes.values()].filter(isMessageTypeNode).sort((a, b) => cmp(a.id, b.id))) {
    const facts = messageTypeFacts(lookup, type, modules);
    const [first] = facts.producers;
    if (first === undefined) continue;
    // Only where the channel's consumers choose by type: elsewhere a type is
    // simply passed on, and nothing says each should have a handler.
    if (!facts.receivers.some((receiver) => receiver.takes === 'selects')) continue;
    const said = unselectedSaid(facts);
    if (said === undefined) continue;
    rows.push({
      file: first.file ?? '',
      line: first.line ?? 0,
      reason: 'message-type-unselected',
      message: said.said,
      // The publish, which is code to read; the type is in `meta`.
      symbol: first.id,
      service: first.repo,
      meta: { type: type.id, channel: facts.channel?.id, messageType: facts.value, sureness: said.sureness },
    });
  }
  return rows;
};

/** The type nodes no live code selects, where the channel's consumers choose by type. */
export const unselectedTypesOf = (rows: readonly Unresolved[]): string[] =>
  [...new Set(rows.flatMap((row) => (row.reason === 'message-type-unselected' && typeof row.meta?.['type'] === 'string' ? [row.meta['type']] : [])))].sort(cmp);
