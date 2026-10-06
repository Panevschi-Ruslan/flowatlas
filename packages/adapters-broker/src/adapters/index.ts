import { hasAnyDependency, type CustomBrokerConfig, type NameLocator } from '@flowatlas/core';
import { awsBrokerAdapters } from './aws.js';
import type { BrokerSpec, ConsumerPattern, SubscriberPattern } from './types.js';

/**
 * The transports this package knows.
 *
 * Each one is a description rather than a parser: which call publishes, which
 * argument names the channel, and which decorators mark a handler. Adding
 * another transport is another record.
 */

/** The ordinary address: one plain argument, written where the call is. */
const FIRST_ARGUMENT: readonly NameLocator[] = [{ kind: 'argument', index: 0 }];

/**
 * The queue a receiver is bound to, named on whatever provided it.
 *
 * `queue.add('send-email', job)` says which job and not which queue: the queue is
 * the receiver's identity, and it was named once, on the parameter that asked for
 * it. Nothing in the call can be read and nothing is missing — the name is one
 * indirection away.
 */
const QUEUE_OF_RECEIVER: readonly NameLocator[] = [
  { kind: 'provider-decorator', decorator: 'InjectQueue', index: 0 },
];

/**
 * The queue a worker class declares, written either way round.
 *
 * `@Processor('mail')` and `@Processor({ name: 'mail' })` are the same statement,
 * and two locators in one list is how one description reads both without either
 * shape knowing about the other.
 *
 * The property is asked **first**, and the order is the whole of it. A record is
 * itself a legal address on this side of the graph — the framework's own transport
 * matches `send({ cmd: 'sum' })` against a decorator written the same way — so the
 * plain argument does not fail on an options object, it succeeds with the wrong
 * answer: `@Processor({ name: 'reports' })` resolved to a channel called
 * `{"name":"reports"}`, which reads like an answer and is one nothing else can
 * ever write. Asking the narrower locator first is the same lesson the table
 * locators learned from a real repository's query builder.
 */
/**
 * Where the message sits in what a worker's handler is handed.
 *
 * This transport does not hand a handler the job it was sent: it hands it the
 * library's own record of that job - the name, the attempt count, the options -
 * with the message one property in. The publishing call takes the message
 * plainly, so the two ends name two different values, and until the
 * descriptions could say so, comparing them accused a correct handler of
 * requiring every field of a message nobody had sent it (R133).
 */
const JOB_ENVELOPE: readonly string[] = ['data'];

const QUEUE_OF_CLASS: readonly NameLocator[] = [
  { kind: 'argument-property', index: 0, key: 'name' },
  { kind: 'argument', index: 0 },
];

/** Two calls every client of the framework's transport layer offers. */
const CLIENT_PROXY_PRODUCERS = [
  { method: 'emit', channelArg: 0, payloadArg: 1, kind: 'event', receiverPackages: ['@nestjs/microservices'] },
  { method: 'send', channelArg: 0, payloadArg: 1, kind: 'rpc', receiverPackages: ['@nestjs/microservices'] },
];

/** Two decorators every handler of that transport layer uses. */
const CLIENT_PROXY_CONSUMERS = [
  { decorator: 'EventPattern', channel: FIRST_ARGUMENT, kind: 'event' },
  { decorator: 'MessagePattern', channel: FIRST_ARGUMENT, kind: 'rpc' },
];

const kafka: BrokerSpec = {
  name: 'nestjs-kafka',
  detect: (pkg) => hasAnyDependency(pkg, ['kafkajs', '@nestjs/microservices']),
  producerPatterns: CLIENT_PROXY_PRODUCERS,
  consumerDecorators: ['EventPattern', 'MessagePattern'],
  consumerPatterns: CLIENT_PROXY_CONSUMERS,
  channelKind: 'topic',
};

const rabbitmq: BrokerSpec = {
  name: 'nestjs-rabbitmq',
  detect: (pkg) => hasAnyDependency(pkg, ['amqplib', 'amqp-connection-manager', '@golevelup/nestjs-rabbitmq']),
  producerPatterns: [
    ...CLIENT_PROXY_PRODUCERS,
    // The channel is addressed in two parts: a group and a key within it.
    {
      method: 'publish',
      channelArg: 1,
      payloadArg: 2,
      exchangeArg: 0,
      kind: 'message',
      receiverPackages: ['@golevelup/nestjs-rabbitmq', 'amqplib', 'amqp-connection-manager'],
    },
  ],
  consumerDecorators: ['EventPattern', 'MessagePattern', 'RabbitSubscribe'],
  consumerPatterns: [
    ...CLIENT_PROXY_CONSUMERS,
    {
      decorator: 'RabbitSubscribe',
      channel: [{ kind: 'argument-property', index: 0, key: 'routingKey' }],
      kind: 'message',
    },
  ],
  channelKind: 'exchange',
};

const bullmq: BrokerSpec = {
  name: 'bullmq',
  detect: (pkg) => hasAnyDependency(pkg, ['bullmq', '@nestjs/bullmq', 'bull', '@nestjs/bull']),
  producerPatterns: [
    // The queue itself is the channel, and the receiver is bound to one; the
    // first argument names the unit of work, not the channel.
    {
      method: 'add',
      channelArg: -1,
      channel: QUEUE_OF_RECEIVER,
      nameArg: 0,
      payloadArg: 1,
      kind: 'job',
      receiverPackages: ['bullmq', 'bull', '@nestjs/bullmq', '@nestjs/bull'],
    },
    {
      method: 'addBulk',
      channelArg: -1,
      channel: QUEUE_OF_RECEIVER,
      payloadArg: 0,
      kind: 'job',
      receiverPackages: ['bullmq', 'bull', '@nestjs/bullmq', '@nestjs/bull'],
    },
  ],
  consumerDecorators: ['Process', 'Processor'],
  consumerPatterns: [
    {
      decorator: 'Process',
      classDecorator: 'Processor',
      channel: QUEUE_OF_CLASS,
      nameArgIndex: 0,
      payloadPath: JOB_ENVELOPE,
      kind: 'job',
    },
    // A worker class handles its queue through one method.
    {
      decorator: 'Processor',
      classDecorator: 'Processor',
      channel: QUEUE_OF_CLASS,
      payloadPath: JOB_ENVELOPE,
      kind: 'job',
    },
  ],
  channelKind: 'queue',
};

/** The two clients of this transport, named once for all three descriptions. */
const REDIS_PACKAGES = ['ioredis', 'redis'];

/**
 * One subscription verb of this transport, in every spelling it is written in.
 *
 * There are three verbs — the plain one, the pattern one, the sharded one — and
 * each is spelled two ways: one client keeps the wire's own lower case,
 * `psubscribe`, and the current major version of the other camel-cases the
 * prefix, `pSubscribe`. Written out by hand that is six strings and a seventh
 * whenever a client adds a verb, and the description held two of the six, so
 * the pattern subscriptions of the most widely installed client for this
 * transport were read by nothing (R135).
 *
 * Both facts follow from the prefix: the spellings are the prefix on the verb,
 * and the event carrying what arrives is the prefix on `message`. So a fourth
 * verb is one more entry in the list below, and a spelling nobody writes yet is
 * one line here rather than one line per verb.
 */
const subscribeVerb = (prefix: string): SubscriberPattern => ({
  method: prefix === '' ? 'subscribe' : [`${prefix}subscribe`, `${prefix}Subscribe`],
  channelArg: 0,
  // One client hands the listener to the subscribe call itself, the other
  // registers it separately on the same connection. Both are described, and a
  // call site uses one of them.
  handlerArg: 1,
  listenerMethod: 'on',
  listenerEvent: `${prefix}message`,
  receiverPackages: REDIS_PACKAGES,
  kind: 'message',
});

const redisPubSub: BrokerSpec = {
  name: 'redis-pubsub',
  detect: (pkg) => hasAnyDependency(pkg, REDIS_PACKAGES),
  producerPatterns: [
    { method: 'publish', channelArg: 0, payloadArg: 1, kind: 'message', receiverPackages: REDIS_PACKAGES },
  ],
  consumerDecorators: [],
  consumerPatterns: [],
  // Receiving here is a call, not a decorator: one call names the channel and
  // either that call or another registers what runs when a message arrives.
  subscriberPatterns: ['', 'p', 's'].map(subscribeVerb),
  channelKind: 'channel',
};

/**
 * The types a socket call is made on, at either end of the wire.
 *
 * The server's `Server`, `Namespace`, `Socket` and `BroadcastOperator` all come
 * from `socket.io`; the browser's `Socket` comes from `socket.io-client`. One
 * list, because `emit` and `on` mean the same thing whichever of them is
 * holding the wire — which is the fact this whole description rests on.
 */
const SOCKET_PACKAGES = ['socket.io', 'socket.io-client'];

/**
 * A socket, read from both ends.
 *
 * `socket.emit('order:updated', …)` in a browser and `@SubscribeMessage`
 * in a gateway name the same event, and a name written in two repositories that
 * nothing joins is exactly what a channel is for. So this is one description
 * and not two: the service half uses the decorators, the browser half uses the
 * calls, and both arrive at the same channel node because they resolve the same
 * name the same way.
 *
 * Note what is deliberately absent. A room — `socket.to(room).emit(…)` — names
 * an audience, not a channel; the event is still the channel and the room is
 * ignored, because inventing a channel per room would join services by an
 * addressing detail neither of them agreed on. And `@SubscribeMessage` is not
 * given `acknowledgedKind`'s treatment: the decorator is the same whether or
 * not a handler answers, so nothing at the receiving end says which it is, and
 * a guess there would be a claim the source does not make.
 */
const socketio: BrokerSpec = {
  name: 'socketio',
  detect: (pkg) => hasAnyDependency(pkg, ['@nestjs/websockets', 'socket.io', 'socket.io-client']),
  producerPatterns: [
    { method: 'emit', channelArg: 0, payloadArg: 1, kind: 'event', receiverPackages: SOCKET_PACKAGES },
  ],
  consumerDecorators: ['SubscribeMessage'],
  consumerPatterns: [
    // The connection comes first and the message second, unless the handler
    // marked the message, in which case where it was written says nothing.
    {
      decorator: 'SubscribeMessage',
      channel: FIRST_ARGUMENT,
      payloadArg: 1,
      payloadDecorator: 'MessageBody',
      kind: 'event',
    },
  ],
  // Receiving in a browser is a call, and the same call registers what runs.
  subscriberPatterns: [
    { method: 'on', channelArg: 0, handlerArg: 1, receiverPackages: SOCKET_PACKAGES, kind: 'event' },
    { method: 'once', channelArg: 0, handlerArg: 1, receiverPackages: SOCKET_PACKAGES, kind: 'event' },
  ],
  acknowledgedKind: 'rpc',
  channelPrefix: {
    classDecorator: 'WebSocketGateway',
    optionKey: 'namespace',
    separator: '/',
    // The same endpoint, stated on the value instead of the class: a server's
    // `io.of('/orders')`, a browser's `io(`${base}/orders`)`, and the socket a
    // `connection` listener is handed on either. The emitter the client's
    // socket inherits `on` from is its own package, so it is named too.
    carriedBy: {
      packages: [...SOCKET_PACKAGES, '@socket.io/component-emitter'],
      opens: ['io', 'lookup', 'of', 'socket'],
      connection: ['connection', 'connect'],
    },
  },
  reservedChannels: [
    'connect',
    'connect_error',
    'connection',
    'disconnect',
    'disconnecting',
    'error',
    'newListener',
    'removeListener',
  ],
  // Not a kind of its own: the core names the four shapes a channel can have,
  // and a socket event is the plain one — many may listen, nothing queues.
  channelKind: 'channel',
};

export const brokerAdapters: readonly BrokerSpec[] = [
  kafka,
  rabbitmq,
  bullmq,
  redisPubSub,
  socketio,
  ...awsBrokerAdapters,
];

/**
 * One described handler, from either spelling.
 *
 * A bare decorator name is the shorthand and reads exactly as it always did.
 * Written out, it can say where the decorator puts the channel — which is the
 * half of R86 the consumer side needed: a project whose handlers are marked
 * `@OnJob({ name: … })` could describe the publish and not the handler, so its
 * channels had one end and joined nothing.
 */
const consumerOf = (described: CustomBrokerConfig['consumers'][number]): ConsumerPattern =>
  typeof described === 'string'
    ? { decorator: described, channel: FIRST_ARGUMENT, kind: 'event' }
    : {
        decorator: described.decorator,
        ...(described.classDecorator === undefined
          ? {}
          : { classDecorator: described.classDecorator }),
        channel: described.channel,
        ...(described.payloadArg === undefined ? {} : { payloadArg: described.payloadArg }),
        ...(described.payloadPath === undefined ? {} : { payloadPath: described.payloadPath }),
        kind: described.kind,
      };

/**
 * An adapter built from configuration, for a bus a project wrote itself.
 *
 * There is no package to detect, so the description is the detection: naming a
 * receiver type and a publishing method is enough to find every call site.
 */
export const createCustomBrokerAdapter = (config: CustomBrokerConfig): BrokerSpec => ({
  name: config.name,
  detect: () => true,
  producerPatterns: config.producers.map((producer) => ({
    // A function of the project's own is named by itself; a method by the
    // type it is called on. The schema has already refused anything else.
    ...(producer.function === undefined
      ? { method: producer.method ?? '', receiverType: producer.receiverType }
      : { method: producer.function, calledAs: 'function' as const }),
    channelArg: producer.channelArg,
    ...(producer.channel === undefined ? {} : { channel: producer.channel }),
    ...(producer.address === undefined ? {} : { address: producer.address }),
    ...(producer.payload === undefined ? {} : { payload: producer.payload }),
    ...(producer.payloadArg === undefined ? {} : { payloadArg: producer.payloadArg }),
    ...(producer.payloadPath === undefined ? {} : { payloadPath: producer.payloadPath }),
    kind: producer.kind,
  })),
  consumerDecorators: config.consumers.map(consumerOf).map((each) => each.decorator),
  consumerPatterns: config.consumers.map(consumerOf),
  // A bus of one's own usually has no decorator to mark a handler: it is a call
  // that names a channel and hands over what to run. Described the same way the
  // publishing call is, by the type it is made on.
  subscriberPatterns: config.subscribers.map((subscriber) => ({
    method: subscriber.method,
    channelArg: subscriber.channelArg,
    ...(subscriber.channel === undefined ? {} : { channel: subscriber.channel }),
    ...(subscriber.handlerArg === undefined ? {} : { handlerArg: subscriber.handlerArg }),
    receiverType: subscriber.receiverType,
    kind: subscriber.kind,
  })),
  channelKind: config.channelKind,
});

export { bullmq, kafka, rabbitmq, redisPubSub, socketio };
export { awsBrokerAdapters } from './aws.js';
export type { BrokerSpec, ChannelPrefix, ConsumerPattern, EndpointCarrier, SubscriberPattern } from './types.js';
