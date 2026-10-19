/**
 * An AsyncAPI 3.0 document of one service's channels, written from the graph
 * (P118): the inverse of `read.ts`.
 *
 * A channel is the project's, not a service's (I6), so a service's document
 * holds the ends of channels it has: a `send` operation for every publish it
 * makes, a `receive` operation for every consumer of it. The channel is
 * written by its address, the id without its prefix, which is what the
 * reader turns back into the same channel node.
 *
 * What a consumer is handed is often the message wrapped by the platform that
 * delivered it. The payload written is the message as published - what the
 * code reads out of the wrapping, through the same envelope the contract
 * check reads it through (R172) - and the wrapping is said beside it as
 * `x-flowatlas-envelope`: where in what is handed over the message sits, and
 * whether it is text there.
 */
import { envelopeOf, readThrough, type GraphLookup } from '@flowatlas/contracts';
import { envelopePath, STARTS_META, type Confidence, type GraphEdge, type GraphNode } from '@flowatlas/core';
import {
  callersBy,
  channelConsumers,
  channelProducers,
  cmp,
  count,
  serviceNodes,
  sortedRecord,
  sourceOf,
  SPEC_VERSION_SAID,
  type SpecCaller,
  type SpecOperation,
  type SpecOptions,
  type WrittenSpec,
} from '../document/written.js';
import { shapeWriter, unreadCounts, UNREAD_KEY, type JsonSchema, type ShapeRoot } from '../document/write-shapes.js';

/** The version of the specification written. */
export const ASYNCAPI_VERSION = '3.0.0';

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** A key every map of an AsyncAPI document accepts: `^[\w\d.\-_]+$`. */
const keyOf = (name: string): string => {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned === '' ? 'channel' : cleaned;
};

/** One end of one channel this service has, before it is written. */
interface End {
  action: 'send' | 'receive';
  node: GraphNode;
  channel: GraphNode;
  edge: GraphEdge;
  payload: string | undefined;
  /** Why nothing is said about the payload, when nothing is. */
  unread?: string;
  envelope?: { path: string; text: boolean };
  forwardsTo?: string[];
  confidence: Confidence;
  callers: SpecCaller[];
  file?: string;
  line?: number;
}

/** The handler a consumer answers, which is where its payload type is. */
const consumerHandles = (lookup: GraphLookup, consumer: GraphNode): GraphEdge | undefined => {
  const declared = consumer.meta?.['entryId'];
  const method = lookup.edgesFrom(consumer.id, ['handles'])[0]?.to;
  if (typeof declared === 'string') {
    const handles = lookup.edgesFrom(declared, ['handles']);
    const found = handles.find((edge) => edge.to === method) ?? handles[0];
    if (found !== undefined) return found;
  }
  if (method === undefined) return undefined;
  return lookup.edgesTo(method, ['handles']).find((edge) => lookup.node(edge.from)?.type === 'entry');
};

/**
 * What a consumer reads off its channel: the type its handler takes, or, for
 * a consumer a deployment declares, the type the code it delivers to reads out
 * of the wrapping. A delivery that hands the message on to another channel
 * reads none of it, and says where it goes.
 */
const consumed = (lookup: GraphLookup, consumer: GraphNode): Pick<End, 'payload' | 'unread' | 'envelope' | 'forwardsTo'> => {
  const handles = consumerHandles(lookup, consumer);
  if (handles !== undefined) {
    const payload = text(handles.meta?.['body']) ?? handles.params?.[0];
    return payload === undefined ? { payload, unread: 'payload-unread' } : { payload };
  }
  const target = lookup
    .edgesFrom(consumer.id, ['calls'])
    .map((edge) => lookup.node(edge.to))
    .filter((node): node is GraphNode => node !== undefined)
    .sort((a, b) => cmp(a.id, b.id))[0];
  if (target?.type === 'producer') {
    const onward = lookup.edgesFrom(target.id, ['emits']).map((edge) => edge.to.replace(/^channel:/, '')).sort(cmp);
    return { payload: undefined, unread: 'payload-unread', forwardsTo: onward };
  }
  const envelope = envelopeOf(consumer);
  if (target?.type !== 'entry' || envelope === undefined) return { payload: undefined, unread: 'payload-unread' };
  const reading = readThrough(lookup, target, envelope);
  return {
    payload: reading.typeId,
    ...(reading.typeId === undefined ? { unread: 'payload-unread' } : {}),
    envelope: { path: envelopePath(envelope.at), text: envelope.text },
  };
};

const endsOf = (lookup: GraphLookup, service: string, omitted: Record<string, number>): End[] => {
  const ends: End[] = [];
  for (const producer of serviceNodes(lookup, 'producer', service)) {
    const emits = lookup.edgesFrom(producer.id, ['emits']).sort((a, b) => cmp(a.to, b.to));
    // A start of a workflow or a function by its name is a call, not a channel.
    if (emits.length === 0 && typeof producer.meta?.[STARTS_META] !== 'string') count(omitted, 'channel-unread');
    for (const edge of emits) {
      const channel = lookup.node(edge.to);
      if (channel === undefined) continue;
      const payload = edge.params?.[0];
      ends.push({
        action: 'send',
        node: producer,
        channel,
        edge,
        payload,
        ...(payload === undefined ? { unread: 'payload-unread' } : {}),
        confidence: edge.confidence,
        callers: channelConsumers(lookup, channel.id),
        ...((edge.file ?? producer.file) === undefined ? {} : { file: edge.file ?? producer.file }),
        ...((edge.line ?? producer.line) === undefined ? {} : { line: edge.line ?? producer.line }),
      });
    }
  }
  for (const consumer of serviceNodes(lookup, 'consumer', service)) {
    const said = consumed(lookup, consumer);
    for (const edge of lookup.edgesTo(consumer.id, ['consumes']).sort((a, b) => cmp(a.from, b.from))) {
      const channel = lookup.node(edge.from);
      if (channel === undefined) continue;
      ends.push({
        action: 'receive',
        node: consumer,
        channel,
        edge,
        ...said,
        confidence: edge.confidence,
        callers: channelProducers(lookup, channel.id),
        ...(consumer.file === undefined ? {} : { file: consumer.file }),
        ...(consumer.line === undefined ? {} : { line: consumer.line }),
      });
    }
  }
  return ends.sort((a, b) => cmp(a.channel.id, b.channel.id) || cmp(a.action, b.action) || cmp(a.node.id, b.node.id));
};

/**
 * The AsyncAPI document of one service's channel ends; nothing when it has
 * none. Every operation carries its own message, since two publishers of one
 * channel in one service can send two shapes.
 */
export const writeAsyncapiDocument = (lookup: GraphLookup, service: string, options: SpecOptions = {}): WrittenSpec | undefined => {
  const omitted: Record<string, number> = {};
  const ends = endsOf(lookup, service, omitted);
  if (ends.length === 0) return undefined;
  const roots: ShapeRoot[] = ends.flatMap((end) =>
    end.payload === undefined ? [] : [{ ref: end.payload, side: end.action === 'send' ? ('sender' as const) : ('receiver' as const) }],
  );
  const writer = shapeWriter(lookup, roots, options);

  const channelKeys = new Map<string, string>();
  const takenChannels = new Set<string>();
  const channelKeyOf = (channel: GraphNode): string => {
    const known = channelKeys.get(channel.id);
    if (known !== undefined) return known;
    const base = keyOf(channel.id.replace(/^channel:/, ''));
    let key = base;
    for (let n = 2; takenChannels.has(key); n += 1) key = `${base}_${n}`;
    takenChannels.add(key);
    channelKeys.set(channel.id, key);
    return key;
  };

  const channels: Record<string, { address: string; messages: Record<string, unknown>; extra: Record<string, unknown> }> = {};
  const operationsOut: Record<string, unknown> = {};
  const messages: Record<string, unknown> = {};
  const operations: SpecOperation[] = [];
  const takenOperations = new Set<string>();

  for (const end of ends) {
    const channelKey = channelKeyOf(end.channel);
    const address = end.channel.id.replace(/^channel:/, '');
    let key = `${end.action}.${channelKey}`;
    const base = key;
    for (let n = 2; takenOperations.has(key); n += 1) key = `${base}_${n}`;
    takenOperations.add(key);

    const kind = text(end.channel.meta?.['channelKind']);
    const channel = channels[channelKey] ?? { address, messages: {}, extra: kind === undefined ? {} : { 'x-flowatlas-channel-kind': kind } };
    channel.messages[key] = { $ref: `#/components/messages/${key}` };
    channels[channelKey] = channel;

    const payload: JsonSchema | undefined = end.payload === undefined ? undefined : writer.schemaOf(end.payload, end.action === 'send' ? 'sender' : 'receiver');
    messages[key] = {
      name: key,
      ...(payload === undefined ? {} : { payload }),
      ...(end.unread === undefined ? {} : { [UNREAD_KEY]: end.unread }),
    };

    const caller = end.action === 'send' ? lookup.edgesTo(end.node.id, ['calls'])[0]?.from : undefined;
    const summary = caller === undefined ? end.node.label : (lookup.node(caller)?.label ?? end.node.label);
    const source = sourceOf(end);
    operationsOut[key] = {
      action: end.action,
      channel: { $ref: `#/channels/${channelKey}` },
      messages: [{ $ref: `#/channels/${channelKey}/messages/${key}` }],
      summary,
      ...(end.envelope === undefined ? {} : { 'x-flowatlas-envelope': end.envelope }),
      ...(end.forwardsTo === undefined ? {} : { 'x-flowatlas-forwards-to': end.forwardsTo }),
      ...(end.action === 'send' && end.node.kind === 'rpc' ? { 'x-flowatlas-expects-reply': true } : {}),
      ...(source === undefined ? {} : { 'x-flowatlas-source': source }),
      'x-flowatlas-confidence': end.confidence,
      [end.action === 'send' ? 'x-flowatlas-consumers' : 'x-flowatlas-callers']: callersBy(end.callers),
    };
    operations.push({
      // Two ends of one channel in one service are told apart by the code
      // each is in, which a moved line does not change; set below.
      key: `${end.action} ${address}\u0000${summary}`,
      kind: end.action,
      node: end.node.id,
      pointer: ['operations', key],
      channel: end.channel.id,
      callers: end.callers,
      confidence: end.confidence,
      ...(end.file === undefined ? {} : { file: end.file }),
      ...(end.line === undefined ? {} : { line: end.line }),
    });
  }

  const plain = new Map<string, number>();
  for (const operation of operations) {
    const said = operation.key.slice(0, operation.key.indexOf('\u0000'));
    plain.set(said, (plain.get(said) ?? 0) + 1);
  }
  for (const operation of operations) {
    const [said = '', by = ''] = operation.key.split('\u0000');
    operation.key = (plain.get(said) ?? 0) > 1 ? `${said} (${by})` : said;
  }

  const { document: written, components } = writer.finish({ messages: sortedRecord(Object.entries(messages)) });
  const document: Record<string, unknown> = {
    asyncapi: ASYNCAPI_VERSION,
    info: {
      title: service,
      version: SPEC_VERSION_SAID,
      description: `The channels ${service} publishes to and consumes from, as flowatlas read them from the code. Nothing here was run.`,
    },
    channels: sortedRecord(
      Object.entries(channels).map(([key, channel]) => [key, { address: channel.address, messages: sortedRecord(Object.entries(channel.messages)), ...channel.extra }]),
    ),
    operations: sortedRecord(Object.entries(operationsOut)),
    components: {
      messages: written.messages,
      ...(Object.keys(components).length === 0 ? {} : { schemas: components }),
    },
    ...(Object.keys(omitted).length === 0 ? {} : { 'x-flowatlas-omitted': sortedRecord(Object.entries(omitted)) }),
  };
  return {
    kind: 'asyncapi',
    service,
    name: service,
    document,
    operations: operations.sort((a, b) => cmp(a.key, b.key) || cmp(a.node, b.node)),
    omitted: sortedRecord(Object.entries(omitted)),
    unread: sortedRecord(Object.entries(unreadCounts(document))),
  };
};
