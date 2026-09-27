/**
 * A service nobody here can read, taken from the AsyncAPI document that
 * describes it.
 *
 * Everything the OpenAPI reader established holds here unchanged and is not
 * restated: the output is an ordinary `RepoGraph`, every fact carries the
 * document it came from, a document that cannot be read at all throws, and
 * nothing is ever presented as having been checked against the running service.
 * Those decisions are in `../document/declared.ts`, where neither format owns
 * them.
 *
 * Nor is the *joining* different, which is the thing this ticket was raised
 * believing. A channel node is `channel:<address>` with no repository half, by
 * design, so a producer in a repository that was read and a consumer that is
 * only declared land on one node and the contract check finds them there. HTTP
 * needed a route matcher because a URL has holes in it; an address is an
 * equality, and there is no matching to write. Channels are cheaper than routes,
 * not different.
 *
 * What genuinely differs is one indirection, and it is below in
 * `operationsBesideChannels`. Version 3 makes `operations` a sibling of
 * `channels` and has each one point in by `$ref`, with the address in the
 * channel's `address` field rather than in its key; version 2 puts the operation
 * back inside the channel, where the key is the address, exactly as OpenAPI puts
 * a verb inside a path item. So the collection iterated is not the collection
 * that yields the node, in one of the two shapes and not the other, and no
 * single description expresses both containments. That is the whole of the new
 * code; the rest of this file is what a document's words mean, which is a table.
 */
import {
  DECLARED_CONFIDENCE,
  SCHEMA_VERSION,
  makeChannelId,
  makeEntryId,
  makeSymbolId,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeRegistry,
} from '@flowatlas/core';
import {
  DECLARED_BY,
  DocumentError,
  shapeName,
  type ReadDocumentOptions,
  type ReadDocumentResult,
} from '../document/declared.js';
import type { JsonSchemaNode } from '../document/schema.js';
import {
  inlineName,
  refOf,
  registerComponents,
  sealHashes,
  type ShapeContext,
} from '../document/shapes.js';
import {
  CHANNEL_ENDS,
  asyncapiDocumentSchema,
  channelOperationSchema,
  channelSchema,
  messageSchema,
  operationSchema,
  type AsyncapiDocument,
  type AsyncapiMessage,
  type ChannelEnd,
} from './document.js';

/** What a transport calls a thing addressed by name, when the document does not say. */
const CHANNEL_KIND = 'channel';

/** Named on every node this reader produces, as the adapter that produced it. */
const ADAPTER = 'asyncapi';

/** One end of one channel, as either containment yields it. */
interface DeclaredEnd {
  /** The operation's name in the document, which is what a reader will see. */
  name: string;
  /** The address a broker would recognise, which is the channel node's identity. */
  address: string;
  end: ChannelEnd;
  /** The shape that travels, or nothing when the document describes none. */
  payload: JsonSchemaNode | undefined;
  summary: string | undefined;
}

/** Where a message may be written down, in the two forms a document points with. */
const MESSAGE_PREFIXES = ['#/components/messages/', '#/channels/'];

/**
 * The message a `$ref` names, out of the places a document keeps messages.
 *
 * `#/components/messages/<name>` and `#/channels/<key>/messages/<name>` are the
 * two forms version 3 writes, and a version-2 document inlines the message or
 * points at the components. A reference into anything else resolves to nothing,
 * which the caller reads as a payload it cannot see rather than as an error:
 * half the shapes in a generated document point somewhere this tool does not
 * follow, and refusing the document over one of them would lose the channels
 * too.
 */
const messageAt = (document: AsyncapiDocument, ref: string): AsyncapiMessage | undefined => {
  if (!MESSAGE_PREFIXES.some((prefix) => ref.startsWith(prefix))) return undefined;
  const path = ref.slice(2).split('/');
  let found: unknown = document;
  for (const step of path) {
    if (found === null || typeof found !== 'object') return undefined;
    found = (found as Record<string, unknown>)[decodeURIComponent(step.replace(/~1/g, '/').replace(/~0/g, '~'))];
  }
  const parsed = messageSchema.safeParse(found);
  return parsed.success ? parsed.data : undefined;
};

/** How far a chain of message references is followed before it gives up. */
const MOST_LINKS = 8;

/**
 * A message as written, with its references followed.
 *
 * A chain rather than one step, because that is what documents actually write:
 * an operation points at the channel's message, and the channel's message points
 * at the one under `components`. Following a single link found the reference
 * instead of the payload and reported the channel as carrying nothing — a
 * declared end that looks complete and compares against nothing at all, which is
 * the failure a declared service must never have. Bounded, so that a document
 * whose messages refer to each other ends the walk rather than the process.
 */
const messageOf = (
  document: AsyncapiDocument,
  written: AsyncapiMessage | undefined,
): AsyncapiMessage | undefined => {
  let found = written;
  for (let depth = 0; depth < MOST_LINKS; depth += 1) {
    if (found === undefined || typeof found.$ref !== 'string') return found;
    found = messageAt(document, found.$ref);
  }
  return undefined;
};

/**
 * The shape the messages of one end agree on.
 *
 * Several messages on one channel is a choice, not a list of channels, so it is
 * read as the choice JSON Schema already spells: the registry and the comparison
 * both understand `oneOf`, and the contract check walks a choice arm by arm and
 * says which arm a disagreement is about. Taking the first and passing over the
 * rest would have reported drift against half of what may legitimately arrive.
 */
const payloadOf = (messages: readonly (AsyncapiMessage | undefined)[]): JsonSchemaNode | undefined => {
  const payloads = messages.flatMap((message) => {
    if (message === undefined) return [];
    if (Array.isArray(message.oneOf) && message.oneOf.length > 0) {
      return message.oneOf.flatMap((each) => (each.payload === undefined ? [] : [each.payload]));
    }
    return message.payload === undefined ? [] : [message.payload];
  });
  if (payloads.length === 0) return undefined;
  return payloads.length === 1 ? payloads[0] : { oneOf: payloads };
};

/** The key a `#/channels/<key>` reference names, when it names one. */
const channelKeyOf = (ref: string | undefined): string | undefined => {
  if (typeof ref !== 'string' || !ref.startsWith('#/channels/')) return undefined;
  const key = ref.slice('#/channels/'.length);
  return key === '' || key.includes('/') ? undefined : key.replace(/~1/g, '/').replace(/~0/g, '~');
};

/**
 * Version 3: the operations are a sibling of the channels and point in by `$ref`.
 *
 * This is the indirection, and it is the only part of reading an AsyncAPI
 * document that a description cannot reach. The operation says what it does, the
 * channel it refers to says where, and the channel's *key* is a name internal to
 * the document — `address` is what a broker would recognise, so that is the
 * name. An operation pointing at a channel that is not there declares nothing
 * anybody could join, and is passed over rather than joined to a channel named
 * after a dangling reference.
 */
const operationsBesideChannels = (document: AsyncapiDocument): DeclaredEnd[] =>
  Object.entries(document.operations ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([name, raw]) => {
      const operation = operationSchema.parse(raw);
      const end = CHANNEL_ENDS[operation.action ?? ''];
      const key = channelKeyOf(operation.channel?.$ref);
      if (end === undefined || key === undefined) return [];
      const found = (document.channels as Record<string, unknown>)[key];
      if (found === undefined) return [];
      const channel = channelSchema.parse(found);
      const messages =
        operation.messages === undefined || operation.messages.length === 0
          ? Object.values(channel.messages ?? {}).map((message) => messageOf(document, message))
          : operation.messages.map((message) => messageOf(document, message));
      return [
        {
          name,
          address: channel.address ?? key,
          end,
          payload: payloadOf(messages),
          summary: operation.summary,
        },
      ];
    });

/**
 * Version 2: the operation is inside the channel, under the word for what it is.
 *
 * The same containment OpenAPI uses for a verb inside a path item, which is why
 * this walk is the shorter of the two: the key of the channel is the address,
 * and there is nothing to follow. The words are looked up rather than tested
 * for, so `parameters`, `bindings` and `description` are not mistaken for ends.
 */
const operationsInsideChannels = (document: AsyncapiDocument): DeclaredEnd[] =>
  Object.entries(document.channels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([address, item]) =>
      Object.entries(item as Record<string, unknown>).flatMap(([word, raw]) => {
        const end = CHANNEL_ENDS[word];
        if (end === undefined || raw === null || typeof raw !== 'object') return [];
        const operation = channelOperationSchema.parse(raw);
        return [
          {
            name: operation.operationId ?? `${word} ${address}`,
            address,
            end,
            payload: payloadOf([messageOf(document, operation.message)]),
            summary: operation.summary,
          },
        ];
      }),
    );

/**
 * Which walk reads this document, by where it keeps its operations.
 *
 * A lookup on the containment rather than on the version string, because the
 * containment is the thing that differs and the version is only a claim about
 * it. Naming the two shapes is also what keeps a third one — should a later
 * release move the operations again — an entry here rather than a branch
 * threaded through the reader.
 */
const WALKS: Record<'sibling' | 'inside', (document: AsyncapiDocument) => DeclaredEnd[]> = {
  sibling: operationsBesideChannels,
  inside: operationsInsideChannels,
};

/**
 * Reads one document into the graph of one service.
 *
 * Each end becomes what a repository reading the same code would have produced:
 * a channel the whole project shares, the method behind it, and either a
 * producer publishing to the channel or an entry point and a consumer taking
 * messages off it. Nothing downstream is taught that a declared end exists —
 * `boundaries()` pairs producers against consumers at the channel node and never
 * asks which of them was read.
 */
export const readAsyncapiDocument = (
  raw: unknown,
  options: ReadDocumentOptions,
): ReadDocumentResult => {
  if (raw === null || typeof raw !== 'object') {
    throw new DocumentError(`${options.documentPath} is not an object`);
  }
  const parsed = asyncapiDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DocumentError(
      `${options.documentPath} could not be read as an AsyncAPI document: ${parsed.error.issues[0]?.message ?? 'unknown reason'}`,
    );
  }
  const document = parsed.data;
  const { service, documentPath } = options;

  const registry: TypeRegistry = {};
  const declaredIn = `${service}#${documentPath}`;
  const context: ShapeContext = { service, declaredIn, registry };
  registerComponents(document.components?.schemas ?? {}, context);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const declared = { [DECLARED_BY]: documentPath };
  const channels = new Set<string>();

  /**
   * One channel node however many ends of it this document declares.
   *
   * The one thing here that is deliberately *not* marked `declaredBy`. A channel
   * node belongs to the whole project rather than to a service — that is why its
   * id carries no repository half and why the linker unions the `adapters` of
   * every source that named it — so a claim that this document declared it would
   * be wrong the moment a repository that was read names the same address, which
   * is the ordinary case and the entire point. What the document declared is its
   * own end of the channel: the producer, the consumer, the entry and the method,
   * each of which says so. The document's part in naming the channel is recorded
   * where the model already keeps that fact, in `adapters`.
   */
  const channelNode = (address: string): string => {
    const id = makeChannelId(address);
    if (channels.has(id)) return id;
    channels.add(id);
    nodes.push({
      id,
      type: 'channel',
      label: address,
      repo: service,
      file: documentPath,
      meta: { channelKind: CHANNEL_KIND, adapters: [ADAPTER] },
    });
    return id;
  };

  const ends = WALKS[document.operations === undefined ? 'inside' : 'sibling'](document);

  for (const { name, address, end, payload, summary } of ends) {
    const channelId = channelNode(address);
    const methodId = makeSymbolId(service, documentPath, name);
    const shape = shapeName(name);
    const payloadRef =
      payload === undefined ? undefined : refOf(payload, context, inlineName(shape, 'Payload'));
    const said = {
      repo: service,
      file: documentPath,
      meta: { ...declared, ...(summary === undefined ? {} : { summary }) },
    };

    nodes.push({ id: methodId, type: 'method', label: name, ...said });

    if (end === 'emits') {
      // A publish nobody here can open, standing where the call would be. The
      // document names one per operation, so the operation is its identity;
      // there is no line in a document to identify it by the way a call site is.
      const producerId = `producer:${methodId}`;
      nodes.push({
        id: producerId,
        type: 'producer',
        label: `message ${address}`,
        kind: 'message',
        ...said,
        meta: { kind: 'message', adapter: ADAPTER, channelVia: 'address', ...declared },
      });
      edges.push({
        from: methodId,
        to: producerId,
        type: 'calls',
        confidence: DECLARED_CONFIDENCE,
        file: documentPath,
        meta: { ...declared },
      });
      edges.push({
        from: producerId,
        to: channelId,
        type: 'emits',
        confidence: DECLARED_CONFIDENCE,
        file: documentPath,
        ...(payloadRef === undefined ? {} : { params: [payloadRef] }),
        meta: { ...declared },
      });
      continue;
    }

    // A handler for messages off the channel. The entry point is where the
    // payload shape lives, because that is where a repository puts it: the
    // contract check finds a consumer's shape by going to the entry the consumer
    // answers, and a declared consumer with no entry would compare against
    // nothing while looking complete.
    const entryId = makeEntryId(service, 'event', address);
    const consumerId = `consumer:${methodId}`;
    nodes.push({
      id: entryId,
      type: 'entry',
      label: `event ${address}`,
      kind: 'event',
      ...said,
      meta: { adapter: ADAPTER, pattern: address, ...declared },
    });
    nodes.push({
      id: consumerId,
      type: 'consumer',
      label: name,
      kind: 'message',
      ...said,
      meta: { kind: 'message', adapter: ADAPTER, entryId, ...declared },
    });
    edges.push({
      from: entryId,
      to: methodId,
      type: 'handles',
      confidence: DECLARED_CONFIDENCE,
      file: documentPath,
      ...(payloadRef === undefined ? {} : { params: [payloadRef] }),
      meta: { ...declared, ...(payloadRef === undefined ? {} : { body: payloadRef }) },
    });
    edges.push({
      from: consumerId,
      to: methodId,
      type: 'handles',
      confidence: DECLARED_CONFIDENCE,
      file: documentPath,
      meta: { ...declared },
    });
    edges.push({
      from: channelId,
      to: consumerId,
      type: 'consumes',
      confidence: DECLARED_CONFIDENCE,
      file: documentPath,
      meta: { ...declared },
    });
  }

  sealHashes(registry, declaredIn);

  return {
    declared: ends.length,
    graph: {
      schemaVersion: SCHEMA_VERSION,
      repo: service,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      nodes,
      edges,
      types: registry,
      unresolved: [],
      meta: {
        ...declared,
        ...(document.info?.version === undefined ? {} : { documentVersion: document.info.version }),
      },
    },
  };
};
