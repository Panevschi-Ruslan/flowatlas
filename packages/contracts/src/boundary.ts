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
import { envelopePath, STARTS_META, type Envelope, type GraphEdge, type GraphNode } from '@flowatlas/core';
import { envelopeOf, readThrough, wrapped, type Blocked } from './envelope.js';
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
  blocked?: Blocked;
  /**
   * The receiver reads part of what it is handed and carries the rest on, so a
   * key it does not read is not a key nobody reads.
   */
  carriesOn?: boolean;
  /**
   * Keys the platform wrote beside the message on the way, which nobody at the
   * sending end put there and nobody is told about as sent.
   */
  wrapperKeys?: readonly string[];
  /** Clauses a finding adds, saying what the message passed through on the way (R172). */
  via?: string[];
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

/**
 * The document an end was declared by, when nobody here could read its source.
 *
 * Read off the node rather than off the configuration, because by the time a
 * boundary is being judged the configuration is two packages away and the fact
 * is already on every node and edge the document produced. A service that was
 * read carries nothing here and the key is left off the party entirely, so the
 * absence of it means "read" rather than "not looked into".
 */
const declaredBy = (lookup: GraphLookup, id: string): string | undefined => {
  const said = lookup.node(id)?.meta?.['declaredBy'];
  return typeof said === 'string' ? said : undefined;
};

const party = (
  lookup: GraphLookup,
  service: string,
  typeId: string | undefined,
  symbol: string,
): ContractParty => {
  const document = declaredBy(lookup, symbol);
  return {
    service,
    typeId: namesAShape(typeId) ? typeId : null,
    symbol,
    ...(document === undefined ? {} : { declaredBy: document }),
  };
};

/**
 * The two ends of an answer, whichever way the question was asked.
 *
 * A route and a request over a channel are answered the same way: the handler
 * declares what it returns, and the edge that asked carries what the asker
 * expects back as its `returns`. Read in one place so that the answer to a
 * `client.send` is compared exactly as the answer to an `http.get` is, rather
 * than by a second reading that could drift from the first (R151).
 */
const answer = (
  lookup: GraphLookup,
  handler: { service: string; handles: GraphEdge | undefined; symbol: string },
  asker: { service: string; asked: GraphEdge; symbol: string },
): { sender: ContractParty; receiver: ContractParty } => ({
  sender: party(lookup, handler.service, handler.handles?.returns, handler.symbol),
  receiver: party(lookup, asker.service, asker.asked.returns, asker.symbol),
});

/**
 * The kind of publish that waits for an answer.
 *
 * Every reader of a transport writes it on the producer, whether the call is a
 * request by its name — `client.send` — or by the callback it hands over. A
 * publish of any other kind expects nothing back, so it has no answer to be
 * compared or to be missing a type for.
 */
const REQUEST_KIND = 'rpc';

const asksForAnswer = (lookup: GraphLookup, emit: GraphEdge): boolean =>
  lookup.node(emit.from)?.kind === REQUEST_KIND;

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

  // A procedure asked for by its path. Neither direction has two shapes to
  // compare: the input is on the entry by name only, and the answer is typed on
  // the client by inference from the server's tree. Said per direction, so the
  // report names what is missing on each rather than putting the handler's
  // parameters — a context and an envelope — against what the caller sends.
  if (typeof lookup.node(edge.from)?.meta?.['procedure'] === 'string') {
    const input = lookup.node(edge.to)?.meta?.['input'];
    const callerParty = party(lookup, callerService, undefined, caller);
    const handlerParty = party(lookup, handlerService, undefined, handler);
    return [
      {
        ...both('request', callerParty, handlerParty),
        blocked: {
          reason: 'procedure-input-by-name' as const,
          subject: edge.to,
          ...(typeof input === 'string' ? { detail: input } : {}),
        },
      },
      {
        ...both('response', handlerParty, callerParty),
        blocked: { reason: 'procedure-output-inferred' as const, subject: edge.to },
      },
    ];
  }

  if (handles.length > 1) {
    const blocked = {
      reason: 'ambiguous-handler' as const,
      subject: edge.to,
    };
    return (['request', 'response'] as const).map((direction) => ({
      ...both(
        direction,
        party(lookup, callerService, undefined, caller),
        party(lookup, handlerService, undefined, edge.to),
      ),
      blocked,
    }));
  }

  const sender = lookup.node(edge.from)?.meta;
  const written = sender?.['bodyKeys'];
  const readable = Array.isArray(written) && written.every((key) => typeof key === 'string');
  const request = both(
    'request',
    {
      ...party(lookup, callerService, edge.params?.[0], caller),
      ...(readable
        ? { writes: written as string[], writesEvery: sender?.['bodyFrom'] === 'literal' }
        : {}),
    },
    party(lookup, handlerService, bodyTypeOf(handles[0]), handler),
  );
  const replied = answer(
    lookup,
    { service: handlerService, handles: handles[0], symbol: handler },
    { service: callerService, asked: edge, symbol: caller },
  );
  const response = both('response', replied.sender, replied.receiver);
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

/** One end read through a wrapping: the party, and whatever stopped it being compared. */
interface Delivered {
  receiver: ContractParty;
  blocked?: Blocked;
  carriesOn: boolean;
  via?: string[];
}

const deployed = (node: GraphNode): boolean => typeof node.meta?.['deployedBy'] === 'string';

const viaOf = (clauses: string[] | undefined): { via?: string[] } =>
  clauses === undefined || clauses.length === 0 ? {} : { via: clauses };

/** The channels a publisher sends to, for a sentence that says where a message went on to. */
const channelsOf = (lookup: GraphLookup, producer: string): string =>
  lookup
    .edgesFrom(producer, ['emits'])
    .map((edge) => edge.to)
    .sort()
    .join(', ');

/** The code an entry runs, read through the wrapping the message is handed to it in. */
const throughEnvelope = (lookup: GraphLookup, wrapper: GraphNode, entry: GraphNode): Delivered => {
  const envelope = envelopeOf(wrapper);
  // The reader that drew the delivery says how it wraps the message, or says
  // nothing because that is not known; why is that reader's to say.
  if (envelope === undefined) {
    return {
      receiver: party(lookup, entry.repo, undefined, entry.id),
      blocked: { reason: 'envelope-unread', subject: wrapper.id },
      carriesOn: false,
    };
  }
  const reading = readThrough(lookup, entry, envelope);
  return {
    receiver: party(lookup, entry.repo, reading.typeId, reading.symbol),
    ...(reading.blocked === undefined ? {} : { blocked: reading.blocked }),
    carriesOn: reading.carriesOn,
    via: reading.via,
  };
};

/**
 * Who a consumer a deployment declares hands the message to, and what that
 * reads of it.
 *
 * Such a consumer has no handler of its own: it is a delivery, and the code it
 * runs is the function or the workflow it reaches. `undefined` for a consumer
 * that is neither, which is read as it always was.
 */
const deliveredTo = (lookup: GraphLookup, consumer: GraphNode): Delivered | undefined => {
  const target = lookup
    .edgesFrom(consumer.id, ['calls'])
    .map((edge) => lookup.node(edge.to))
    .filter((node): node is GraphNode => node !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const blocked = (reason: Blocked['reason'], detail?: string): Delivered => ({
    receiver: party(lookup, consumer.repo, undefined, consumer.id),
    blocked: { reason, subject: consumer.id, ...(detail === undefined || detail === '' ? {} : { detail }) },
    carriesOn: false,
  });
  if (target === undefined) return deployed(consumer) ? blocked('delivery-target-unread') : undefined;
  if (target.type === 'producer') return blocked('delivered-onward', channelsOf(lookup, target.id));
  if (target.type !== 'entry') return blocked('delivery-target-unread');
  return throughEnvelope(lookup, consumer, target);
};

/**
 * Why a sending end has nothing to compare, said before anything about the
 * receiving end, the way a sender with no type always was: a delivery or a
 * route that hands on what it was given has no type of its own to declare.
 */
const unsent = (
  lookup: GraphLookup,
  producer: GraphNode | undefined,
  sent: string | undefined,
  symbol: string,
): Blocked | undefined => {
  if (namesAShape(sent)) return undefined;
  return producer !== undefined && deployed(producer)
    ? { reason: 'sender-forwards', subject: producer.id }
    : { reason: 'no-type-on-sender', subject: symbol };
};

/** A publisher whose message a delivery forwards, with the message as it is forwarded. */
interface Upstream {
  emit: GraphEdge;
  typeId: string;
  /** The service whose delivery forwards it. */
  forwarder: string;
  envelope: Envelope;
}

/**
 * Where a message a delivery forwards came from, wrapped as the delivery hands it on.
 *
 * One hop: a publisher that itself forwards is not followed further back.
 */
const forwardedFrom = (lookup: GraphLookup, forwarder: string): Upstream[] =>
  lookup
    .edgesTo(forwarder, ['calls'])
    .map((edge) => lookup.node(edge.from))
    .filter((node): node is GraphNode => node?.type === 'consumer')
    .flatMap((consumer) => {
      const envelope = envelopeOf(consumer);
      if (envelope === undefined) return [];
      return lookup.edgesTo(consumer.id, ['consumes']).flatMap((consume) =>
        lookup.edgesTo(consume.from, ['emits']).flatMap((emit) => {
          const sent = emit.params?.[0];
          const typeId = namesAShape(sent) ? wrapped(sent, envelope) : undefined;
          return typeId === undefined
            ? []
            : [{ emit, typeId, forwarder: consumer.repo, envelope }];
        }),
      );
    })
    .sort((a, b) => (a.emit.from < b.emit.from ? -1 : a.emit.from > b.emit.from ? 1 : 0));

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
        sender: party(lookup, repoOf(lookup, end), undefined, end),
        receiver: party(lookup, repoOf(lookup, end), undefined, end),
        symbols: [],
        blocked: { reason, subject: channel.id },
      },
    ];
  }

  const found: Exchange[] = [];
  for (const emit of emits) {
    const publisher = callerOf(lookup, emit.from);
    const publisherService = repoOf(lookup, emit.from);
    const producer = lookup.node(emit.from);
    // A delivery that hands on what it was delivered sends nothing of its own:
    // what it sends is its publishers' messages, wrapped.
    const upstream = emit.params?.[0] === undefined ? forwardedFrom(lookup, emit.from) : [];
    for (const consume of consumes) {
      const consumer = lookup.node(consume.to);
      if (consumer === undefined) continue;
      const handles = entryOfConsumer(lookup, consumer);
      const delivered = handles === undefined ? deliveredTo(lookup, consumer) : undefined;
      const handler = delivered?.receiver.symbol ?? handles?.to ?? consume.to;
      const handlerService = consumer.repo;
      const receiver =
        delivered?.receiver ?? party(lookup, handlerService, bodyTypeOf(handles) ?? handles?.params?.[0], handler);
      const through = delivered?.carriesOn === true ? { carriesOn: true } : {};
      // Keyed by the publisher that wrote the message and the handler that
      // reads it, like any message on a channel: the forwarding is the medium.
      for (const from of upstream) {
        const shape = { from: from.emit.from, to: consume.to, type: 'emits' };
        const origin = callerOf(lookup, from.emit.from);
        found.push({
          edge: shape,
          edgeKey: edgeKeyOf(shape),
          direction: 'payload',
          sender: party(lookup, repoOf(lookup, from.emit.from), from.typeId, origin),
          receiver,
          symbols: [origin, handler],
          ...through,
          ...(delivered?.blocked === undefined ? {} : { blocked: delivered.blocked }),
          ...(from.envelope.beside === undefined ? {} : { wrapperKeys: from.envelope.beside }),
          via: [
            `${from.forwarder} hands it on as it is delivered, the message at ${envelopePath(from.envelope.at)}${from.envelope.text ? ' as text' : ''}`,
            ...(delivered?.via ?? []),
          ],
        });
      }
      if (upstream.length > 0) continue;
      const shape = { from: emit.from, to: consume.to, type: 'emits' };
      const edgeKey = edgeKeyOf(shape);
      const blocked = unsent(lookup, producer, emit.params?.[0], publisher) ?? delivered?.blocked;
      found.push({
        edge: shape,
        edgeKey,
        direction: 'payload',
        sender: party(lookup, publisherService, emit.params?.[0], publisher),
        receiver,
        symbols: [publisher, handler],
        ...through,
        ...(blocked === undefined ? {} : { blocked }),
        ...viaOf(delivered?.via),
      });
      // A request and an answer, over a channel. The kind of the publish says
      // whether there is an answer at all; whether either end declares its type
      // is the comparison's to say, in the words it says it for a route.
      if (asksForAnswer(lookup, emit)) {
        found.push({
          edge: shape,
          edgeKey,
          direction: 'response',
          ...answer(
            lookup,
            { service: handlerService, handles, symbol: handler },
            { service: publisherService, asked: emit, symbol: publisher },
          ),
          symbols: [publisher, handler],
        });
      }
    }
  }
  return found;
};

/**
 * A call that starts a workflow or invokes a function by its deployed name,
 * and what that reads of what it is handed (R172).
 *
 * The start is a request: the caller hands over its input and the far end
 * reads it, through the wrapping the call says it is handed in. Its answer,
 * where there is one, is bytes nobody here declares, so only the request is
 * compared.
 */
const startExchanges = (lookup: GraphLookup, producer: GraphNode): Exchange[] =>
  lookup.edgesFrom(producer.id, ['calls']).flatMap((call) => {
    const entry = lookup.node(call.to);
    if (entry?.type !== 'entry') return [];
    const caller = callerOf(lookup, producer.id);
    const said = producer.meta?.['payload'];
    const sent = typeof said === 'string' ? said : undefined;
    const delivered = throughEnvelope(lookup, producer, entry);
    const blocked = unsent(lookup, producer, sent, caller) ?? delivered.blocked;
    const shape = { from: producer.id, to: entry.id, type: call.type };
    return [
      {
        edge: shape,
        edgeKey: edgeKeyOf(shape),
        direction: 'request' as const,
        sender: party(lookup, producer.repo, sent, caller),
        receiver: delivered.receiver,
        symbols: [caller, delivered.receiver.symbol],
        ...(blocked === undefined ? {} : { blocked }),
        ...(delivered.carriesOn ? { carriesOn: true } : {}),
        ...viaOf(delivered.via),
      },
    ];
  });

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
  for (const producer of lookup.nodesByType('producer')) {
    if (typeof producer.meta?.[STARTS_META] === 'string') found.push(...startExchanges(lookup, producer));
  }
  return found.sort(
    (a, b) =>
      cmp(a.edgeKey, b.edgeKey) ||
      cmp(a.direction, b.direction) ||
      cmp(a.receiver.symbol, b.receiver.symbol),
  );
};
