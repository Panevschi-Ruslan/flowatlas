import { hasAnyDependency, type CustomBrokerConfig } from '@flowatlas/core';
import type { BrokerSpec } from './types.js';

/**
 * The transports this package knows.
 *
 * Each one is a description rather than a parser: which call publishes, which
 * argument names the channel, and which decorators mark a handler. Adding
 * another transport is another record.
 */

/** Two calls every client of the framework's transport layer offers. */
const CLIENT_PROXY_PRODUCERS = [
  { method: 'emit', channelArg: 0, payloadArg: 1, kind: 'event', receiverPackages: ['@nestjs/microservices'] },
  { method: 'send', channelArg: 0, payloadArg: 1, kind: 'rpc', receiverPackages: ['@nestjs/microservices'] },
];

/** Two decorators every handler of that transport layer uses. */
const CLIENT_PROXY_CONSUMERS = [
  { decorator: 'EventPattern', channelFrom: 'argument' as const, argIndex: 0, kind: 'event' },
  { decorator: 'MessagePattern', channelFrom: 'argument' as const, argIndex: 0, kind: 'rpc' },
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
      channelFrom: 'option',
      argIndex: 0,
      optionKey: 'routingKey',
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
      channelFromParameterDecorator: 'InjectQueue',
      nameArg: 0,
      payloadArg: 1,
      kind: 'job',
      receiverPackages: ['bullmq', 'bull', '@nestjs/bullmq', '@nestjs/bull'],
    },
    {
      method: 'addBulk',
      channelArg: -1,
      channelFromParameterDecorator: 'InjectQueue',
      payloadArg: 0,
      kind: 'job',
      receiverPackages: ['bullmq', 'bull', '@nestjs/bullmq', '@nestjs/bull'],
    },
  ],
  consumerDecorators: ['Process', 'Processor'],
  consumerPatterns: [
    {
      decorator: 'Process',
      channelFrom: 'class-decorator',
      classDecorator: 'Processor',
      nameArgIndex: 0,
      kind: 'job',
    },
    // A worker class handles its queue through one method.
    {
      decorator: 'Processor',
      channelFrom: 'class-decorator',
      classDecorator: 'Processor',
      kind: 'job',
    },
  ],
  channelKind: 'queue',
};

const redisPubSub: BrokerSpec = {
  name: 'redis-pubsub',
  detect: (pkg) => hasAnyDependency(pkg, ['ioredis', 'redis']),
  producerPatterns: [
    { method: 'publish', channelArg: 0, payloadArg: 1, kind: 'message', receiverPackages: ['ioredis', 'redis'] },
  ],
  consumerDecorators: [],
  consumerPatterns: [],
  // Receiving here is a call, not a decorator: one call names the channel and
  // another registers what runs when a message arrives.
  subscriberPatterns: [
    {
      method: 'subscribe',
      channelArg: 0,
      handlerArg: 1,
      listenerMethod: 'on',
      listenerEvent: 'message',
      receiverPackages: ['ioredis', 'redis'],
      kind: 'message',
    },
    {
      method: 'psubscribe',
      channelArg: 0,
      handlerArg: 1,
      listenerMethod: 'on',
      listenerEvent: 'pmessage',
      receiverPackages: ['ioredis', 'redis'],
      kind: 'message',
    },
  ],
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
    { decorator: 'SubscribeMessage', channelFrom: 'argument' as const, argIndex: 0, kind: 'event' },
  ],
  // Receiving in a browser is a call, and the same call registers what runs.
  subscriberPatterns: [
    { method: 'on', channelArg: 0, handlerArg: 1, receiverPackages: SOCKET_PACKAGES, kind: 'event' },
    { method: 'once', channelArg: 0, handlerArg: 1, receiverPackages: SOCKET_PACKAGES, kind: 'event' },
  ],
  payloadFromCallSite: true,
  acknowledgedKind: 'rpc',
  channelPrefix: { classDecorator: 'WebSocketGateway', optionKey: 'namespace', separator: '/' },
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

export const brokerAdapters: readonly BrokerSpec[] = [kafka, rabbitmq, bullmq, redisPubSub, socketio];

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
    method: producer.method,
    channelArg: producer.channelArg,
    ...(producer.payloadArg === undefined ? {} : { payloadArg: producer.payloadArg }),
    receiverType: producer.receiverType,
    kind: producer.kind,
  })),
  consumerDecorators: [...config.consumers],
  consumerPatterns: config.consumers.map((decorator) => ({
    decorator,
    channelFrom: 'argument' as const,
    argIndex: 0,
    kind: 'event',
  })),
  // A bus of one's own usually has no decorator to mark a handler: it is a call
  // that names a channel and hands over what to run. Described the same way the
  // publishing call is, by the type it is made on.
  subscriberPatterns: config.subscribers.map((subscriber) => ({
    method: subscriber.method,
    channelArg: subscriber.channelArg,
    ...(subscriber.handlerArg === undefined ? {} : { handlerArg: subscriber.handlerArg }),
    receiverType: subscriber.receiverType,
    kind: subscriber.kind,
  })),
  channelKind: config.channelKind,
});

export { bullmq, kafka, rabbitmq, redisPubSub, socketio };
export type { BrokerSpec, ChannelPrefix, ConsumerPattern, SubscriberPattern } from './types.js';
