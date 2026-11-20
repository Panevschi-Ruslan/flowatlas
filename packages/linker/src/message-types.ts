import {
  DISCRIMINATOR_META,
  isMessageTypeNode,
  makeMessageTypeId,
  MESSAGE_TYPE_KIND,
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
  for (const consumer of sorted) {
    if (consumer.type !== 'consumer') continue;
    const selections = selectionsOf(consumer);
    if (selections.length === 0) continue;
    for (const edge of to.get(consumer.id) ?? []) {
      if (edge.type !== 'consumes') continue;
      const channel = channelOf(edge.from);
      if (channel === undefined) continue;
      for (const selection of selections) {
        if (!nodes.has(selection.consumer)) continue;
        const type = typeNode(channel, selection.type, consumer.meta?.[DISCRIMINATOR_META], consumer);
        add({
          from: type.id,
          to: selection.consumer,
          type: 'consumes',
          confidence: selection.heuristic === true ? 'heuristic' : edge.confidence,
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
