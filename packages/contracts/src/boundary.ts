/**
 * Every place two services have to agree, and who says what at each of them.
 *
 * The graph draws a boundary three ways — a call to another service's route, a
 * request from a browser, a message on a channel — and each of those has two
 * halves that fail differently. The roles are the flow of the data and not the
 * direction of the arrow: on a response the handler is the sender, though the
 * edge points the other way. Getting that backwards would report every answer
 * as a missing request.
 */
import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { edgeKeyOf } from './key.js';
import type { ContractParty, Direction, GraphLookup, UncheckedReason } from './types.js';

/** One direction of one boundary, with both ends already worked out. */
export interface Exchange {
  edge: { from: string; to: string; type: string };
  edgeKey: string;
  direction: Direction;
  sender: ContractParty;
  receiver: ContractParty;
  /** Symbols an annotation could excuse this exchange from. */
  symbols: string[];
  /** Set when there was never anything to compare. */
  blocked?: { reason: UncheckedReason; subject: string; detail?: string };
}

/** References that name no shape, so there is nothing to compare against. */
const EMPTY_REFS = new Set(['', 'void', 'any', 'unknown', 'object', 'never', 'undefined', 'null']);

/** True when the reference actually claims a shape. */
export const namesAShape = (ref: string | undefined): ref is string =>
  ref !== undefined && !EMPTY_REFS.has(ref.trim());

const repoOf = (lookup: GraphLookup, id: string | undefined): string =>
  (id === undefined ? undefined : lookup.node(id)?.repo) ?? 'unknown';

/**
 * The method a reader would open to see this call.
 *
 * A request leaves from a node standing for the call itself, which is a
 * location rather than something anybody wrote; the method that made it is what
 * carries the annotations and what a person wants to look at.
 */
const callerOf = (lookup: GraphLookup, callId: string): string =>
  lookup.edgesTo(callId, ['calls'])[0]?.from ?? callId;

/** The handler a route or a channel entry point leads to. */
const handlerOf = (edge: GraphEdge | undefined, fallback: string): string => edge?.to ?? fallback;

/** The type a handler declares for the body it is given, when it declares one. */
const bodyTypeOf = (handles: GraphEdge | undefined): string | undefined => {
  const body = handles?.meta?.['body'];
  if (typeof body === 'string') return body;
  // Without an annotated body the only honest candidate is a lone parameter
  // that names a shape: a route whose parameters are all path segments has no
  // body, and guessing one would invent a contract nobody wrote (I3).
  const named = (handles?.params ?? []).filter(namesAShape);
  return named.length === 1 ? named[0] : undefined;
};

/** `handles` edges out of an entry point, in a fixed order. */
const handlesOf = (lookup: GraphLookup, entryId: string): GraphEdge[] =>
  lookup.edgesFrom(entryId, ['handles']).sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

const party = (service: string, typeId: string | undefined, symbol: string): ContractParty => ({
  service,
  typeId: namesAShape(typeId) ? typeId : null,
  symbol,
});

/**
 * Both halves of a request, whichever way the request was made.
 *
 * A call between services and a request from a browser differ in what wrote
 * them down and in nothing else that matters here: the same three fields on the
 * edge, the same handler on the far side, the same two things that can be wrong.
 */
const requestExchanges = (lookup: GraphLookup, edge: GraphEdge): Exchange[] => {
  const shape = { from: edge.from, to: edge.to, type: edge.type };
  const edgeKey = edgeKeyOf(edge);
  const callerService = repoOf(lookup, edge.from);
  const caller = callerOf(lookup, edge.from);
  const handlerService = repoOf(lookup, edge.to);
  const handles = handlesOf(lookup, edge.to);
  const handler = handlerOf(handles[0], edge.to);

  const both = (direction: Direction, sender: ContractParty, receiver: ContractParty): Exchange => ({
    edge: shape,
    edgeKey,
    direction,
    sender,
    receiver,
    symbols: [caller, handler],
  });

  if (handles.length > 1) {
    const blocked = {
      reason: 'ambiguous-handler' as const,
      subject: edge.to,
    };
    return (['request', 'response'] as const).map((direction) => ({
      ...both(
        direction,
        party(callerService, undefined, caller),
        party(handlerService, undefined, edge.to),
      ),
      blocked,
    }));
  }

  const request = both(
    'request',
    party(callerService, edge.params?.[0], caller),
    party(handlerService, bodyTypeOf(handles[0]), handler),
  );
  const response = both(
    'response',
    party(handlerService, handles[0]?.returns, handler),
    party(callerService, edge.returns, caller),
  );
  return [request, response];
};

/** The entry point a consumer answers, which is where its payload type is. */
const entryOfConsumer = (lookup: GraphLookup, consumer: GraphNode): GraphEdge | undefined => {
  const declared = consumer.meta?.['entryId'];
  const method = lookup.edgesFrom(consumer.id, ['handles'])[0]?.to;
  if (typeof declared === 'string') {
    const handles = lookup.edgesFrom(declared, ['handles']);
    const found = handles.find((edge) => edge.to === method) ?? handles[0];
    if (found !== undefined) return found;
  }
  if (method === undefined) return undefined;
  return lookup
    .edgesTo(method, ['handles'])
    .find((edge) => lookup.node(edge.from)?.type === 'entry');
};

/**
 * A published message and the handler that reads it.
 *
 * There is no edge between the two: they meet on the channel, which is one node
 * for the whole project by design. The contract is still between the two of
 * them and not between either and the channel, so the pair is what gets a key.
 */
const channelExchanges = (lookup: GraphLookup, channel: GraphNode): Exchange[] => {
  const emits = lookup.edgesTo(channel.id, ['emits']);
  const consumes = lookup.edgesFrom(channel.id, ['consumes']);

  if (emits.length === 0 || consumes.length === 0) {
    if (emits.length === 0 && consumes.length === 0) return [];
    const reason: UncheckedReason =
      emits.length === 0 ? 'channel-without-producer' : 'channel-without-consumer';
    const side = emits[0] ?? consumes[0];
    const end = emits.length === 0 ? (consumes[0]?.to ?? channel.id) : (emits[0]?.from ?? channel.id);
    return [
      {
        edge: { from: side?.from ?? channel.id, to: side?.to ?? channel.id, type: side?.type ?? 'emits' },
        edgeKey: `${channel.id}|${emits.length === 0 ? 'consumes' : 'emits'}|${end}`,
        direction: 'payload',
        sender: party(repoOf(lookup, end), undefined, end),
        receiver: party(repoOf(lookup, end), undefined, end),
        symbols: [],
        blocked: { reason, subject: channel.id },
      },
    ];
  }

  const found: Exchange[] = [];
  for (const emit of emits) {
    const publisher = callerOf(lookup, emit.from);
    const publisherService = repoOf(lookup, emit.from);
    for (const consume of consumes) {
      const consumer = lookup.node(consume.to);
      if (consumer === undefined) continue;
      const handles = entryOfConsumer(lookup, consumer);
      const handler = handles?.to ?? consume.to;
      const handlerService = consumer.repo;
      const shape = { from: emit.from, to: consume.to, type: 'emits' };
      const edgeKey = edgeKeyOf(shape);
      found.push({
        edge: shape,
        edgeKey,
        direction: 'payload',
        sender: party(publisherService, emit.params?.[0], publisher),
        receiver: party(handlerService, bodyTypeOf(handles) ?? handles?.params?.[0], handler),
        symbols: [publisher, handler],
      });
      // A request and an answer, over a channel. Only some transports have one,
      // and the publisher's own return type is what says so.
      if (emit.returns !== undefined) {
        found.push({
          edge: shape,
          edgeKey,
          direction: 'response',
          sender: party(handlerService, handles?.returns, handler),
          receiver: party(publisherService, emit.returns, publisher),
          symbols: [publisher, handler],
        });
      }
    }
  }
  return found;
};

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every boundary in the project, in an order that does not depend on the graph.
 *
 * Sorted here rather than at the end, so the report is the same document
 * whichever order the edges came out of the store in.
 */
export const boundaries = (lookup: GraphLookup): Exchange[] => {
  const found: Exchange[] = [];
  for (const edge of lookup.allEdges()) {
    if (edge.type === 'http_calls' || edge.type === 'hits') {
      found.push(...requestExchanges(lookup, edge));
    }
  }
  for (const channel of lookup.nodesByType('channel')) {
    found.push(...channelExchanges(lookup, channel));
  }
  return found.sort(
    (a, b) =>
      cmp(a.edgeKey, b.edgeKey) ||
      cmp(a.direction, b.direction) ||
      cmp(a.receiver.symbol, b.receiver.symbol),
  );
};
