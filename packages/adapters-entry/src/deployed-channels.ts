import {
  BUCKET_CHANNEL,
  BUCKET_FIELDS,
  bucketChannel,
  CHANGES_CHANNELS,
  changesChannel,
  channelOfTarget,
  deliveryEnvelope,
  DEPLOYED_CHANNELS,
  EVENT_NAME_FIELDS,
  eventChannel,
  eventChannelPattern,
  forwardedToBus,
  queueChannel,
  S3_VERSIONED_DELETE,
  topicChannel,
} from '@flowatlas/aws';
import {
  CHANNEL_DECLARED_META,
  CHANNEL_FORWARD_META,
  CHANNEL_PATTERN_META,
  ENVELOPE_META,
  ENVIRONMENT_META,
  makeChannelId,
  makeEntryId,
  makeEntryReference,
  makeInvokeEntryKey,
  makeSymbolId,
  makeUnnamedInvokeKey,
  makeWorkflowEntryKey,
  MOST_CHOICES,
  REACHED_AS_META,
  REACHES_META,
  RESULT_OF_META,
  type ReachedAs,
  TAKES_META,
  WHERE_DECLARED_META,
  type ChannelForward,
  type Confidence,
  type DeclaredStream,
  type DeployedDelivery,
  type DeployedFunction,
  type DeliverySource,
  type DeliveryTarget,
  type Deployment,
  type EntryNode,
  type EnvironmentValue,
  type ExtractContext,
  type MessagePattern,
  type MessageTarget,
  type Takes,
  type Unresolved,
} from '@flowatlas/core';

/**
 * The subscribers a deployment declares, drawn onto the channels code publishes
 * to (P23).
 *
 * A publisher in code and a subscriber in a deployment meet on one channel node
 * because both spell the channel in the grammar `@flowatlas/aws` states:
 * `sqs/<queue>`, `sns/<topic>`, `eventbridge/<bus>/<source>/<detail type>`.
 * Everything here is that meeting, in two tables: what each kind of source
 * becomes - a consumer of a channel, a schedule, a stream read in order - and
 * what each kind of target is reached by - a function's entry, a workflow by
 * its deployed name, another channel through a publisher of its own. A new kind
 * of either is a row, and the code that walks deliveries does not change.
 */

/** Where a delivery's messages enter the graph, and what it reaches from there. */
interface WayIn {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  /** References by deployed name, joined by the linker. */
  readonly reaches: string[];
  /** The events it takes, as (source, detail type) pairs, when it takes them by name. */
  readonly events?: readonly (readonly [source: string, detailType: string])[];
  /** How far an edge out of it can be trusted: a disabled delivery delivers nothing today. */
  readonly confidence: Confidence;
  /** The entry it is, when it is one rather than a consumer: drawn by the extractor from what is returned. */
  readonly entry?: EntryNode;
  /**
   * The edge it reaches a publisher of its own by: `calls` from a consumer or
   * an entry, `triggers` from a channel that hands on what its readers fail on.
   */
  readonly link?: 'calls' | 'triggers';
  /** The outcome of a run it hands on, for a function's or a mapping's destination (P54). */
  readonly when?: 'success' | 'failure';
}

/** The code a function this deployment creates runs, as its own entry was given it. */
export type DeployedCode = Pick<EntryNode, 'handler' | 'handlerConfidence' | 'wrapping'>;

/** Where nodes are drawn, and the reader they are drawn for. */
interface Canvas {
  readonly ctx: ExtractContext;
  readonly deployedBy: string;
}

/** What drawing one deployment shares between the two tables. */
interface Drawing extends Canvas {
  readonly deployment: Deployment;
  readonly rows: Unresolved[];
  readonly entries: Map<string, EntryNode>;
  /** The handler of a function this deployment creates, by its position. */
  readonly handlerOf: (index: number) => DeployedCode | undefined;
  /** The node each delivery drawn so far enters by, under its address. */
  readonly drawn: ReadonlyMap<string, string>;
  /** A function's `invoke` entry, by id: drawn by the extractor, not here. */
  readonly invoked: (id: string) => EntryNode | undefined;
}

/** What a channel is drawn as: the adapter that reads it, and its kind. */
type ChannelKinds = { readonly adapter: string; readonly channelKind: string };

/**
 * A channel, joined with the one any other delivery drew under its name. A
 * stream's channel is marked as declared by what declares it: a write in code
 * lands on it only then (P51). A mapping that reads a table's stream declares
 * it as surely as the table does; a service that writes to the table says
 * nothing of a stream, and leaves `declaredBy` out (P56).
 */
const channelNode = (drawing: Canvas, name: string, kinds: ChannelKinds, file: string, line: number, declaredBy?: string): string => {
  const { ctx } = drawing;
  const { adapter, channelKind } = kinds;
  const id = makeChannelId(name);
  const existing = ctx.builder.getNode(id);
  const adapters = [...new Set([...((existing?.meta?.['adapters'] as string[] | undefined) ?? []), adapter])];
  const declarer = (existing?.meta?.[CHANNEL_DECLARED_META] as string | undefined) ?? declaredBy;
  const declared = declarer === undefined ? {} : { [CHANNEL_DECLARED_META]: declarer };
  const node = ctx.builder.addNode({ id, type: 'channel', label: name, repo: ctx.repo, file, line, meta: { channelKind, adapters, ...declared } });
  node.meta = { ...node.meta, adapters, ...declared };
  return id;
};

/** The channel of a table's changes or a stream's records. */
const streamChannelNode = (drawing: Canvas, stream: Omit<DeclaredStream, 'address'> & { readonly declaredBy?: string }): string =>
  channelNode(drawing, changesChannel(stream.of, stream.name), CHANGES_CHANNELS[stream.of], stream.file, stream.line, stream.declaredBy);

/** Every (source, detail type) a pattern names exactly, or `undefined` where it does not name them. */
const exactEvents = (pattern: MessagePattern): (readonly [string, string])[] | undefined => {
  const values = EVENT_NAME_FIELDS.map((field) => {
    const filters = pattern.fields[field] ?? [];
    const exact = filters.flatMap((filter) => ('equals' in filter ? [filter.equals] : []));
    return filters.length > 0 && exact.length === filters.length ? [...new Set(exact)] : undefined;
  });
  const [sources, detailTypes] = values;
  if (sources === undefined || detailTypes === undefined || sources.length * detailTypes.length > MOST_CHOICES) return undefined;
  return sources.flatMap((source) => detailTypes.map((detailType) => [source, detailType] as const));
};

/** Fields filtered and not matched on, so an edge can say what it did not check. */
const notMatchedOn = (delivery: DeployedDelivery): string[] => {
  const pattern = delivery.from.kind === 'bus' ? delivery.from.pattern : undefined;
  const unmatched = (delivery.meta?.['unmatched'] as Record<string, unknown> | undefined) ?? {};
  return [
    ...Object.keys(pattern?.unmatched ?? {}),
    ...Object.keys(pattern?.fields ?? {}).filter((field) => !(EVENT_NAME_FIELDS as readonly string[]).includes(field)),
    ...Object.keys(unmatched),
  ].sort();
};

const confidenceOf = (delivery: DeployedDelivery): Confidence => (delivery.meta?.['disabled'] === true ? 'heuristic' : 'static');

/**
 * A consumer node for a delivery that takes messages from a channel.
 *
 * It carries the wrapping its target is handed the message in, where that is
 * known, which is what lets the message be compared with what the target reads
 * rather than with nothing (R172).
 */
const consumerOf = (drawing: Drawing, delivery: DeployedDelivery, kind: string, adapter: string, extra: Record<string, unknown> = {}): WayIn => {
  const { ctx } = drawing;
  const id = `consumer:${makeSymbolId(ctx.repo, delivery.file, delivery.address)}`;
  const skipped = notMatchedOn(delivery);
  const envelope = deliveryEnvelope(delivery);
  ctx.builder.addNode({
    id,
    type: 'consumer',
    label: `${delivery.by} ${delivery.name ?? delivery.address}`,
    repo: ctx.repo,
    file: delivery.file,
    line: delivery.line,
    kind,
    meta: {
      kind,
      adapter,
      by: delivery.by,
      declaredAs: delivery.address,
      deployedBy: drawing.deployedBy,
      ...(delivery.name === undefined ? {} : { name: delivery.name }),
      ...(delivery.meta ?? {}),
      ...(skipped.length === 0 ? {} : { notMatchedOn: skipped }),
      ...(envelope === undefined ? {} : { [ENVELOPE_META]: envelope }),
      ...extra,
    },
  });
  return { id, file: delivery.file, line: delivery.line, reaches: [], confidence: confidenceOf(delivery) };
};

/** One `consumes` edge from a channel to a way in. */
const consume = (drawing: Drawing, channel: string, way: WayIn, delivery: DeployedDelivery): void => {
  const skipped = notMatchedOn(delivery);
  drawing.ctx.builder.addEdge({
    from: channel,
    to: way.id,
    type: 'consumes',
    confidence: way.confidence,
    file: way.file,
    line: way.line,
    meta: {
      by: delivery.by,
      ...(delivery.meta?.['disabled'] === true ? { because: ['the delivery is disabled'] } : {}),
      ...(skipped.length === 0 ? {} : { notMatchedOn: skipped }),
    },
  });
};

/** An entry the deployment's clock or a stream reaches, one per key however many targets it has. */
const entryOf = (drawing: Drawing, delivery: DeployedDelivery, kind: 'cron' | 'event', key: string, meta: Record<string, unknown>): WayIn => {
  const id = makeEntryId(drawing.ctx.repo, kind, key);
  const existing = drawing.entries.get(id);
  const reaches = (existing?.meta?.[REACHES_META] as string[] | undefined) ?? [];
  if (existing === undefined) {
    drawing.entries.set(id, {
      id,
      kind,
      label: `${kind} ${key}`,
      key,
      file: delivery.file,
      line: delivery.line,
      meta: { key, by: delivery.by, declaredAs: delivery.address, deployedBy: drawing.deployedBy, ...meta, [REACHES_META]: reaches },
    });
  }
  return { id, file: delivery.file, line: delivery.line, reaches, confidence: confidenceOf(delivery), entry: drawing.entries.get(id) as EntryNode };
};

type SourceDrawer<K extends DeliverySource['kind']> = (
  drawing: Drawing,
  delivery: DeployedDelivery & { readonly from: Extract<DeliverySource, { kind: K }> },
) => WayIn;

/**
 * What each kind of source becomes.
 *
 * A queue or a topic is a channel with a name, and its reader a consumer of it.
 * Events on a bus are a channel per source and detail type: a pattern that
 * names both exactly is a consumer of each such channel, and any other pattern
 * is a consumer carrying the pattern, which the linker matches against every
 * channel in the project. A schedule and a stream read in order are ways in of
 * their own, `cron` and `event`, because nothing anywhere publishes to them.
 */
const SOURCES: { readonly [K in DeliverySource['kind']]: SourceDrawer<K> } = {
  queue: (drawing, delivery) => {
    const channel = channelNode(drawing, queueChannel(delivery.from.name), DEPLOYED_CHANNELS.queue, delivery.file, delivery.line);
    // A redrive does not read the queue: what its readers fail on is handed on
    // by the queue itself, so a queue nothing reads still reads as one.
    if (delivery.by === 'redrive') {
      return { id: channel, file: delivery.file, line: delivery.line, reaches: [], confidence: confidenceOf(delivery), link: 'triggers' };
    }
    const way = consumerOf(drawing, delivery, 'message', DEPLOYED_CHANNELS.queue.adapter);
    consume(drawing, channel, way, delivery);
    return way;
  },
  topic: (drawing, delivery) => {
    const way = consumerOf(drawing, delivery, 'message', DEPLOYED_CHANNELS.topic.adapter);
    consume(drawing, channelNode(drawing, topicChannel(delivery.from.name), DEPLOYED_CHANNELS.topic, delivery.file, delivery.line), way, delivery);
    return way;
  },
  bus: (drawing, delivery) => {
    const { name: bus, pattern } = delivery.from;
    const events = exactEvents(pattern);
    const way = consumerOf(
      drawing,
      delivery,
      'event',
      DEPLOYED_CHANNELS.bus.adapter,
      events === undefined ? { [CHANNEL_PATTERN_META]: eventChannelPattern(bus, pattern) } : {},
    );
    for (const [source, detailType] of events ?? []) {
      consume(drawing, channelNode(drawing, eventChannel(bus, source, detailType), DEPLOYED_CHANNELS.bus, delivery.file, delivery.line), way, delivery);
    }
    return events === undefined ? way : { ...way, events };
  },
  schedule: (drawing, delivery) =>
    entryOf(drawing, delivery, 'cron', delivery.name ?? delivery.address, {
      ...(delivery.from.expression === undefined ? {} : { schedule: delivery.from.expression }),
      ...(delivery.name === undefined ? { nameRead: false } : {}),
      ...(delivery.meta?.['disabled'] === true ? { disabled: true } : {}),
    }),
  // A stream read in order is an entry onto the function it runs, and the
  // channel code writes onto: the mapping is a consumer of that channel that
  // triggers the entry, so a write reaches the function through it (P51).
  changes: (drawing, delivery) => {
    const { of, name } = delivery.from;
    const way = entryOf(drawing, delivery, 'event', changesChannel(of, name), { changesOf: of, name });
    const channel = streamChannelNode(drawing, { of, name, file: delivery.file, line: delivery.line, declaredBy: delivery.address });
    const consumer = consumerOf(drawing, delivery, CHANGES_CHANNELS[of].kind, CHANGES_CHANNELS[of].adapter);
    consume(drawing, channel, consumer, delivery);
    drawing.ctx.builder.addEdge({
      from: consumer.id,
      to: way.id,
      type: 'triggers',
      confidence: consumer.confidence,
      file: delivery.file,
      line: delivery.line,
      meta: { via: 'deployment' },
    });
    if (notMatchedOn(delivery).length > 0) {
      drawing.rows.push({
        file: delivery.file,
        line: delivery.line,
        reason: 'stream-filter-not-matched',
        level: 'info',
        message: `${delivery.address} hands ${changesChannel(of, name)} on through a filter, which is recorded on its edge and not matched against what is written`,
        hint: 'Every write onto the stream is drawn as reaching the function; the filter decides at run time which of them do.',
        symbol: delivery.address,
      });
    }
    return way;
  },
  // A notification of a bucket takes what writes to it fire, and says which:
  // the linker asks each write whether it is taken (P52).
  bucket: (drawing, delivery) => {
    const { name, events, prefix, suffix, versioned } = delivery.from;
    const takes: Takes = {
      kinds: events,
      ...(versioned === true ? { instead: [S3_VERSIONED_DELETE] } : {}),
      ...(prefix === undefined && suffix === undefined
        ? {}
        : { by: { field: BUCKET_FIELDS.key, ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }) } }),
    };
    const way = consumerOf(drawing, delivery, 'object', BUCKET_CHANNEL.adapter, { [TAKES_META]: takes });
    consume(drawing, channelNode(drawing, bucketChannel(name), BUCKET_CHANNEL, delivery.file, delivery.line), way, delivery);
    return way;
  },
  // A route of a socket API is a way in of its own: nothing publishes to it
  // but a client holding a connection open (R174).
  connection: (drawing, delivery) =>
    entryOf(drawing, delivery, 'event', `websocket/${delivery.from.api}/${delivery.from.route}`, {
      api: delivery.from.api,
      route: delivery.from.route,
      ...(delivery.meta ?? {}),
    }),
  // A user pool or an IoT rule runs its function on something that happens
  // in the service itself, which nothing in code publishes.
  trigger: (drawing, delivery) =>
    entryOf(drawing, delivery, 'event', delivery.from.key, {
      service: delivery.from.service,
      ...(delivery.name === undefined ? {} : { name: delivery.name }),
      ...Object.fromEntries(Object.entries(delivery.meta ?? {}).filter(([key]) => key !== 'when')),
    }),
  // What a run ends in is handed on from the function's own entry, or from
  // where the mapping that gave up took its batches in (P54).
  outcome: (drawing, delivery) => {
    const { of, when } = delivery.from;
    // A function another deployment creates hands its run on into a node of
    // this one's, which the linker joins to that function's entry (P60).
    if ('name' in of) {
      const resultOf = makeEntryReference('invoke', makeInvokeEntryKey(of.name));
      return { ...consumerOf(drawing, delivery, 'result', 'aws-lambda', { [RESULT_OF_META]: resultOf }), link: 'triggers', when };
    }
    const id = 'function' in of ? localFunction(drawing, of.function) : drawing.drawn.get(of.delivery);
    if (id === undefined) return { ...consumerOf(drawing, delivery, 'result', 'aws-lambda'), link: 'triggers', when };
    // An entry this module draws keeps its references on itself until it is returned.
    const reaches = (drawing.entries.get(id)?.meta?.[REACHES_META] as string[] | undefined) ?? [];
    return { id, file: delivery.file, line: delivery.line, reaches, confidence: confidenceOf(delivery), link: 'triggers', when };
  },
};

/** Where a publisher a deployment declares sits, and what declares it. */
interface Declared {
  readonly file: string;
  readonly line: number;
  readonly address: string;
  readonly by: string;
  readonly meta?: Record<string, unknown>;
}

/**
 * When a delivery runs, where that is not on every message: an IoT rule's
 * error action, on a failure of its other actions alone (P56). Kept on what the
 * delivery draws, never on the entry its source shares with the others.
 */
const whenOf = (delivery: Declared): Record<string, unknown> =>
  delivery.meta?.['when'] === undefined ? {} : { when: delivery.meta['when'] };

/** What an edge out of a way in says: drawn from the deployment, and the outcome it carries (P54) or the delivery's own (P56). */
const edgeMeta = (way: WayIn, delivery?: Declared): Record<string, unknown> =>
  way.when === undefined ? { via: 'deployment', ...(delivery === undefined ? {} : whenOf(delivery)) } : { via: 'deployment', when: way.when };

/**
 * A reference by deployed name, and how the linker is to draw the edge it
 * becomes: the same type and outcome an edge to a target this deployment
 * creates would carry (P60). A reference the way in already reaches plainly
 * stays plain, so one edge does not claim an outcome only some of its
 * deliveries carry.
 */
const reachByName = (drawing: Drawing, way: WayIn, delivery: Declared, reference: string): void => {
  const plain = way.reaches.includes(reference);
  way.reaches.push(reference);
  const when = edgeMeta(way, delivery)['when'] as ReachedAs['when'];
  const as: ReachedAs = { ...(way.link === 'triggers' ? { type: 'triggers' } : {}), ...(when === undefined ? {} : { when }) };
  const node = drawing.entries.get(way.id) ?? drawing.ctx.builder.getNode(way.id) ?? drawing.invoked(way.id);
  if (node === undefined) return;
  const recorded = { ...((node.meta?.[REACHED_AS_META] as Record<string, ReachedAs> | undefined) ?? {}) };
  if (plain && recorded[reference] === undefined) return;
  if (Object.keys(as).length === 0) delete recorded[reference];
  else recorded[reference] = as;
  const { [REACHED_AS_META]: _old, ...rest } = node.meta ?? {};
  node.meta = Object.keys(recorded).length === 0 ? rest : { ...rest, [REACHED_AS_META]: recorded };
};

/** A producer a delivery or a route is, reached from where its messages come in. */
const producerNode = (
  drawing: Canvas,
  way: WayIn,
  delivery: Declared,
  { adapter, kind }: { readonly adapter: string; readonly kind: string },
  label: string,
  meta: Record<string, unknown> = {},
): string => {
  const { ctx } = drawing;
  const id = `producer:${makeSymbolId(ctx.repo, delivery.file, delivery.address)}`;
  ctx.builder.addNode({
    id,
    type: 'producer',
    label: `${kind} ${label}`,
    repo: ctx.repo,
    file: delivery.file,
    line: delivery.line,
    kind,
    meta: {
      kind,
      adapter,
      channelVia: 'deployment',
      by: delivery.by,
      declaredAs: delivery.address,
      deployedBy: drawing.deployedBy,
      ...whenOf(delivery),
      ...meta,
    },
  });
  ctx.builder.addEdge({ from: way.id, to: id, type: way.link ?? 'calls', confidence: way.confidence, file: way.file, line: way.line, meta: edgeMeta(way) });
  return id;
};

/** The publisher a delivery or a route is onto a queue, a topic or a bus. */
const publisher = (drawing: Canvas, way: WayIn, delivery: Declared, target: MessageTarget, label: string): string =>
  producerNode(drawing, way, delivery, DEPLOYED_CHANNELS[target.kind], label, way.link === 'triggers' ? (delivery.meta ?? {}) : {});

/** A publisher a delivery or a route is, onto the channel it sends to. */
const forward = (drawing: Canvas, way: WayIn, delivery: Declared, target: MessageTarget, channel: string): void => {
  const id = publisher(drawing, way, delivery, target, channel);
  const to = channelNode(drawing, channel, DEPLOYED_CHANNELS[target.kind], delivery.file, delivery.line);
  drawing.ctx.builder.addEdge({ from: id, to, type: 'emits', confidence: way.confidence, file: way.file, line: way.line, meta: { via: 'deployment' } });
};

type TargetDrawer<K extends DeliveryTarget['kind']> = (
  drawing: Drawing,
  way: WayIn,
  delivery: DeployedDelivery,
  target: Extract<DeliveryTarget, { kind: K }>,
) => void;

/** The entry id of a function this deployment creates. */
const localFunction = (drawing: Drawing, index: number): string | undefined => {
  const fn: DeployedFunction | undefined = drawing.deployment.functions[index];
  if (fn === undefined) return undefined;
  return makeEntryId(drawing.ctx.repo, 'invoke', fn.name === undefined ? makeUnnamedInvokeKey(fn.address) : makeInvokeEntryKey(fn.name));
};

/**
 * A message sent on to a channel: the target's own; for a bus with no fields,
 * each event the source took by name; or, where the source took its events by
 * a pattern, whichever events the pattern matches, which only the whole project
 * knows - so the consumer says where it carries them, and the linker has the
 * publisher put each one there (R174).
 */
const sendOn = (drawing: Drawing, way: WayIn, delivery: DeployedDelivery, target: MessageTarget): void => {
  const named = channelOfTarget(target);
  if (named !== undefined) return forward(drawing, way, delivery, target, named);
  if (target.kind === 'bus' && way.events !== undefined) {
    for (const [source, detailType] of way.events) forward(drawing, way, delivery, target, eventChannel(target.name, source, detailType));
    return;
  }
  const consumer = drawing.ctx.builder.getNode(way.id);
  if (target.kind === 'bus' && consumer?.meta?.[CHANNEL_PATTERN_META] !== undefined) {
    const forwardsTo: ChannelForward = {
      producer: publisher(drawing, way, delivery, target, eventChannel(target.name, '*', '*')),
      parts: forwardedToBus(target.name),
    };
    consumer.meta = { ...consumer.meta, [CHANNEL_FORWARD_META]: forwardsTo };
    return;
  }
  drawing.rows.push({
    file: delivery.file,
    line: delivery.line,
    reason: 'subscription-forward-unread',
    level: 'info',
    message: `${delivery.address} puts what it takes on the bus ${target.name}, and which events those are is not named exactly, so no channel on that bus is drawn`,
    hint: 'Events forwarded to another bus keep their source and detail type; where the rule names both exactly, each forwarded channel is drawn.',
    symbol: delivery.address,
  });
};

/** A function as the code a way in runs, when the way in is an entry that runs none yet. */
const runAsEntry = (drawing: Drawing, way: WayIn, target: Extract<DeliveryTarget, { kind: 'function' }>): boolean => {
  const entry = way.entry;
  if (entry === undefined || entry.handler !== undefined || entry.meta?.['invokes'] !== undefined) return false;
  if ('name' in target) {
    entry.meta = { ...entry.meta, invokes: target.name };
    return true;
  }
  const code = drawing.handlerOf(target.function);
  if (code?.handler === undefined) return false;
  const fn = drawing.deployment.functions[target.function];
  Object.assign(entry, code);
  entry.meta = { ...entry.meta, function: fn?.name ?? fn?.address };
  return true;
};

/**
 * How each kind of target is reached from a way in.
 *
 * A schedule or a stream that runs a function is an entry onto that
 * function's handler, the way a route in front of it is (P21): this
 * deployment's own function by its handler, one deployed elsewhere by its name,
 * which the linker gives the handler of. A consumer of a channel reaches a
 * function through the function's own `invoke` entry, or by a reference to its
 * deployed name; a workflow is always a reference, joined to whichever
 * service declares it. A queue, a topic or a bus is a publisher onto that
 * channel. An entry with a second function to run reaches it the way a
 * consumer does, because an entry has one handler.
 */
const TARGETS: { readonly [K in DeliveryTarget['kind']]: TargetDrawer<K> } = {
  function: (drawing, way, delivery, target) => {
    if (runAsEntry(drawing, way, target)) return;
    if ('name' in target) {
      reachByName(drawing, way, delivery, makeEntryReference('invoke', makeInvokeEntryKey(target.name)));
      return;
    }
    const to = localFunction(drawing, target.function);
    if (to === undefined) return;
    drawing.ctx.builder.addEdge({ from: way.id, to, type: way.link ?? 'calls', confidence: way.confidence, file: way.file, line: way.line, meta: edgeMeta(way, delivery) });
  },
  workflow: (drawing, way, delivery, target) => {
    reachByName(drawing, way, delivery, makeEntryReference('workflow', makeWorkflowEntryKey(target.name)));
  },
  queue: sendOn,
  topic: sendOn,
  bus: sendOn,
  // A write to a table or a record put on a stream, by the service itself: a
  // publisher onto the channel the stream's readers take from (P56).
  changes: (drawing, way, delivery, target) => {
    // A table's changes are a channel only where its stream is declared, as
    // they are for a write in code (P51); a stream's records always are.
    const whereDeclared = target.of === 'table' ? { [WHERE_DECLARED_META]: true } : {};
    const id = producerNode(drawing, way, delivery, CHANGES_CHANNELS[target.of], changesChannel(target.of, target.name), whereDeclared);
    const to = streamChannelNode(drawing, { of: target.of, name: target.name, file: delivery.file, line: delivery.line });
    drawing.ctx.builder.addEdge({ from: id, to, type: 'emits', confidence: way.confidence, file: way.file, line: way.line, meta: { via: 'deployment' } });
  },
};

const drawSource = (drawing: Drawing, delivery: DeployedDelivery): WayIn =>
  (SOURCES[delivery.from.kind] as SourceDrawer<DeliverySource['kind']>)(drawing, delivery as DeployedDelivery & { from: never });

const drawTarget = (drawing: Drawing, way: WayIn, delivery: DeployedDelivery, target: DeliveryTarget): void =>
  (TARGETS[target.kind] as TargetDrawer<DeliveryTarget['kind']>)(drawing, way, delivery, target as never);

/**
 * Every delivery of a deployment drawn into the graph; the entries it adds - a
 * schedule, a stream read in order - are returned for the extractor to draw,
 * and the node each delivery enters by is recorded in `drawn` under its
 * address.
 */
export const drawDeliveries = (
  ctx: ExtractContext,
  deployment: Deployment,
  deployedBy: string,
  rows: Unresolved[],
  drawn: Map<string, string>,
  handlerOf: (index: number) => DeployedCode | undefined,
  invoked: (id: string) => EntryNode | undefined = () => undefined,
): EntryNode[] => {
  const drawing: Drawing = { ctx, deployment, deployedBy, rows, entries: new Map(), handlerOf, drawn, invoked };
  for (const stream of deployment.streams ?? []) streamChannelNode(drawing, { ...stream, declaredBy: stream.address });
  for (const delivery of deployment.deliveries) {
    const way = drawSource(drawing, delivery);
    // A row about the delivery - a target not read, a forward not drawn - is
    // about the node its messages enter by: a consumer, a schedule's entry, or
    // the queue a redrive hands failures on from (R173).
    drawn.set(delivery.address, way.id);
    if (delivery.to !== undefined) drawTarget(drawing, way, delivery, delivery.to);
    // A consumer is drawn by this module and keeps its references on its own
    // node; an entry is drawn by the extractor from what is returned.
    if (way.reaches.length > 0 && !drawing.entries.has(way.id)) {
      const node = ctx.builder.getNode(way.id) ?? invoked(way.id);
      if (node !== undefined) node.meta = { ...node.meta, [REACHES_META]: [...new Set([...((node.meta?.[REACHES_META] as string[] | undefined) ?? []), ...way.reaches])] };
    }
  }
  return [...drawing.entries.values()].map((entry) => {
    const reaches = (entry.meta?.[REACHES_META] as string[] | undefined) ?? [];
    const { [REACHES_META]: _dropped, ...meta } = entry.meta ?? {};
    return { ...entry, meta: reaches.length === 0 ? meta : { ...meta, [REACHES_META]: [...new Set(reaches)] } };
  });
};

/**
 * A route that sends its request to a channel itself: a publisher at the
 * route, onto that channel, reached from the route's entry.
 */
export const drawRouteSends = (
  ctx: ExtractContext,
  routeEntryId: string,
  route: { readonly file: string; readonly line: number; readonly address: string },
  target: MessageTarget,
  deployedBy: string,
): string | undefined => {
  const channel = channelOfTarget(target);
  if (channel === undefined) return undefined;
  const way: WayIn = { id: routeEntryId, file: route.file, line: route.line, reaches: [], confidence: 'static' };
  forward({ ctx, deployedBy }, way, { ...route, by: 'route' }, target, channel);
  return channel;
};

/** The values a function is deployed with, as the graph keeps them on its entry. */
export const environmentMeta = (fn: DeployedFunction): Record<string, unknown> => {
  if (fn.environment === undefined) return {};
  const values: Record<string, EnvironmentValue> = {};
  for (const [variable, setting] of Object.entries(fn.environment)) {
    const value = setting.names?.name ?? setting.text;
    values[variable] = {
      written: setting.written,
      ...(value === undefined ? {} : { value }),
      ...(setting.names === undefined ? {} : { kind: setting.names.kind }),
      ...(setting.unread === undefined
        ? {}
        : {
            unread: setting.unread.text,
            ...(setting.unread.variable === undefined ? {} : { variable: setting.unread.variable }),
            ...(setting.unread.files === undefined ? {} : { files: setting.unread.files }),
          }),
    };
  }
  return { [ENVIRONMENT_META]: values };
};
