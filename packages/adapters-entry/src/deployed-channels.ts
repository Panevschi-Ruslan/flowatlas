import {
  channelOfTarget,
  DEPLOYED_CHANNELS,
  EVENT_NAME_FIELDS,
  eventChannel,
  eventChannelPattern,
  queueChannel,
  topicChannel,
} from '@flowatlas/aws';
import {
  CHANNEL_PATTERN_META,
  ENVIRONMENT_META,
  makeChannelId,
  makeEntryId,
  makeEntryReference,
  makeInvokeEntryKey,
  makeSymbolId,
  makeUnnamedInvokeKey,
  makeWorkflowEntryKey,
  MOST_CHOICES,
  REACHES_META,
  type Confidence,
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
}

const channelNode = (drawing: Canvas, name: string, kind: MessageTarget['kind'], file: string, line: number): string => {
  const { ctx } = drawing;
  const { adapter, channelKind } = DEPLOYED_CHANNELS[kind];
  const id = makeChannelId(name);
  const existing = ctx.builder.getNode(id);
  const adapters = [...new Set([...((existing?.meta?.['adapters'] as string[] | undefined) ?? []), adapter])];
  const node = ctx.builder.addNode({ id, type: 'channel', label: name, repo: ctx.repo, file, line, meta: { channelKind, adapters } });
  node.meta = { ...node.meta, adapters };
  return id;
};

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

/** A consumer node for a delivery that takes messages from a channel. */
const consumerOf = (drawing: Drawing, delivery: DeployedDelivery, kind: string, adapter: string, extra: Record<string, unknown> = {}): WayIn => {
  const { ctx } = drawing;
  const id = `consumer:${makeSymbolId(ctx.repo, delivery.file, delivery.address)}`;
  const skipped = notMatchedOn(delivery);
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
    const channel = channelNode(drawing, queueChannel(delivery.from.name), 'queue', delivery.file, delivery.line);
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
    consume(drawing, channelNode(drawing, topicChannel(delivery.from.name), 'topic', delivery.file, delivery.line), way, delivery);
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
      consume(drawing, channelNode(drawing, eventChannel(bus, source, detailType), 'bus', delivery.file, delivery.line), way, delivery);
    }
    return events === undefined ? way : { ...way, events };
  },
  schedule: (drawing, delivery) =>
    entryOf(drawing, delivery, 'cron', delivery.name ?? delivery.address, {
      ...(delivery.from.expression === undefined ? {} : { schedule: delivery.from.expression }),
      ...(delivery.name === undefined ? { nameRead: false } : {}),
      ...(delivery.meta?.['disabled'] === true ? { disabled: true } : {}),
    }),
  changes: (drawing, delivery) =>
    entryOf(drawing, delivery, 'event', `${delivery.from.of === 'table' ? 'dynamodb' : 'kinesis'}/${delivery.from.name}`, {
      changesOf: delivery.from.of,
      name: delivery.from.name,
    }),
};

/** Where a publisher a deployment declares sits, and what declares it. */
interface Declared {
  readonly file: string;
  readonly line: number;
  readonly address: string;
  readonly by: string;
  readonly meta?: Record<string, unknown>;
}

/** A publisher a delivery or a route is, onto the channel it sends to. */
const forward = (drawing: Canvas, way: WayIn, delivery: Declared, target: MessageTarget, channel: string): void => {
  const { ctx } = drawing;
  const { adapter, kind } = DEPLOYED_CHANNELS[target.kind];
  const id = `producer:${makeSymbolId(ctx.repo, delivery.file, delivery.address)}`;
  ctx.builder.addNode({
    id,
    type: 'producer',
    label: `${kind} ${channel}`,
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
      ...(way.link === 'triggers' ? (delivery.meta ?? {}) : {}),
    },
  });
  ctx.builder.addEdge({ from: way.id, to: id, type: way.link ?? 'calls', confidence: way.confidence, file: way.file, line: way.line, meta: { via: 'deployment' } });
  const to = channelNode(drawing, channel, target.kind, delivery.file, delivery.line);
  ctx.builder.addEdge({ from: id, to, type: 'emits', confidence: way.confidence, file: way.file, line: way.line, meta: { via: 'deployment' } });
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

/** A message sent on to a channel: the target's own, or for a bus with no fields, each event the source took by name. */
const sendOn = (drawing: Drawing, way: WayIn, delivery: DeployedDelivery, target: MessageTarget): void => {
  const named = channelOfTarget(target);
  if (named !== undefined) return forward(drawing, way, delivery, target, named);
  if (target.kind === 'bus' && way.events !== undefined) {
    for (const [source, detailType] of way.events) forward(drawing, way, delivery, target, eventChannel(target.name, source, detailType));
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
  function: (drawing, way, _delivery, target) => {
    if (runAsEntry(drawing, way, target)) return;
    if ('name' in target) {
      way.reaches.push(makeEntryReference('invoke', makeInvokeEntryKey(target.name)));
      return;
    }
    const to = localFunction(drawing, target.function);
    if (to === undefined) return;
    drawing.ctx.builder.addEdge({ from: way.id, to, type: 'calls', confidence: way.confidence, file: way.file, line: way.line, meta: { via: 'deployment' } });
  },
  workflow: (_drawing, way, _delivery, target) => {
    way.reaches.push(makeEntryReference('workflow', makeWorkflowEntryKey(target.name)));
  },
  queue: sendOn,
  topic: sendOn,
  bus: sendOn,
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
): EntryNode[] => {
  const drawing: Drawing = { ctx, deployment, deployedBy, rows, entries: new Map(), handlerOf };
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
      const node = ctx.builder.getNode(way.id);
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
