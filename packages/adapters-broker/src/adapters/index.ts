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

export const brokerAdapters: readonly BrokerSpec[] = [kafka, rabbitmq, bullmq, redisPubSub];

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

export { bullmq, kafka, rabbitmq, redisPubSub };
export type { BrokerSpec, ConsumerPattern, SubscriberPattern } from './types.js';
