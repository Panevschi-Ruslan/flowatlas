import {
  hasAnyDependency,
  manifestsWithin,
  type AddressPart,
  type CallPattern,
  type ChannelKind,
  type NameLocator,
  type PackageJson,
} from '@flowatlas/core';
import { ADDRESS_SEPARATOR } from '../address.js';
import type { BrokerSpec } from './types.js';

/**
 * The AWS SDK's three messaging clients, as descriptions.
 *
 * Each operation is a row: the command it is sent as, the method it is called
 * as, where its input names the address and where it carries the message. The
 * rows are compiled into the same patterns a description in configuration
 * compiles into, using the same locators a person can write there -
 * `constructed-argument-path` for a command, `argument-path` for a method's
 * input - so the SDK is read by nothing a project wrapping it could not describe
 * for itself. The one thing a description in configuration cannot say is
 * `receiverPackages`: it names a client by its class alone.
 *
 * Three shapes of call reach each operation, and every row reads all three:
 *
 * - `client.send(new PutEventsCommand(input))`, version 3, with the command
 *   built in the call or in a constant before it;
 * - `client.putEvents(input)`, version 3's aggregated client;
 * - `service.putEvents(input).promise()`, version 2 - the same method, the same
 *   input, the client declared in `aws-sdk`.
 *
 * Only publishing is read here. Who receives - a rule, a subscription, a
 * mapping from a queue to a function - is declared in the deployment and not
 * in code, and is read from there.
 */

/**
 * How a channel of each service is named.
 *
 * The grammar both ends of a channel have to agree on, stated once: a publisher
 * read from code arrives at it through the descriptions below, and a subscriber
 * read from a deployment arrives at it through these functions, so the two land
 * on one node. Each name starts with its service, because a queue and a topic
 * are often given the same name and are not the same channel.
 *
 * - a queue is `sqs/<queue name>`;
 * - a topic is `sns/<topic name>`;
 * - an event is `eventbridge/<bus>/<source>/<detail type>`, and the bus an
 *   entry leaves out is the one the service calls `default`, written out.
 *
 * Names are the deployed names, never a URL or an ARN: `QueueUrl` and
 * `TopicArn` are read through `DEPLOYED_FORMS` to the name inside them, which
 * is what a deployment names the same resource by.
 */
export const AWS_SERVICE_PREFIX = { sqs: 'sqs', sns: 'sns', eventbridge: 'eventbridge' } as const;

/** The bus an event goes to when its entry names none. */
export const DEFAULT_EVENT_BUS = 'default';

/**
 * The longer spellings a deployed name is written inside, each with the name as
 * its first group: a queue's URL (the regional endpoint, the legacy one and a
 * local emulator's alike), and the ARN of a queue, a topic and a bus.
 */
export const DEPLOYED_FORMS = {
  queue: ['^https?://[^/]+/[^/]+/([^/?#]+)/?$', '^arn:[^:]+:sqs:[^:]*:[^:]*:([^:]+)$'],
  topic: ['^arn:[^:]+:sns:[^:]*:[^:]*:([^:]+)$'],
  bus: ['^arn:[^:]+:events:[^:]*:[^:]*:event-bus/(.+)$'],
} as const;

export const queueChannel = (name: string): string =>
  [AWS_SERVICE_PREFIX.sqs, name].join(ADDRESS_SEPARATOR);

export const topicChannel = (name: string): string =>
  [AWS_SERVICE_PREFIX.sns, name].join(ADDRESS_SEPARATOR);

export const eventChannel = (bus: string | undefined, source: string, detailType: string): string =>
  [AWS_SERVICE_PREFIX.eventbridge, bus ?? DEFAULT_EVENT_BUS, source, detailType].join(ADDRESS_SEPARATOR);

/** A part of an address, written against the operation's input rather than a call. */
type InputPart =
  | { readonly literal: string }
  | {
      readonly path: readonly string[];
      readonly absent?: string;
      readonly forms?: readonly string[];
    };

/** One operation that publishes. */
interface Operation {
  /** The command class version 3 sends it as. */
  readonly command: string;
  /** The method both clients that take the input directly call it as. */
  readonly method: string;
  readonly address: readonly InputPart[];
  /** Where in the input the message is. */
  readonly payload: readonly string[];
}

/** One service: its package, its clients, and what it publishes. */
interface Service {
  readonly adapter: string;
  readonly channelKind: ChannelKind;
  /** What a publish is recorded as. */
  readonly kind: string;
  /** The version 3 package. */
  readonly package: string;
  /** The version 3 client that sends commands. */
  readonly client: string;
  /** The class version 3's aggregated client and version 2's client share. */
  readonly service: string;
  readonly operations: readonly Operation[];
}

/** The version 2 SDK, one package for every service. */
const V2_PACKAGE = 'aws-sdk';

const QUEUE: readonly InputPart[] = [
  { literal: AWS_SERVICE_PREFIX.sqs },
  { path: ['QueueUrl'], forms: DEPLOYED_FORMS.queue },
];

const TOPIC: readonly InputPart[] = [
  { literal: AWS_SERVICE_PREFIX.sns },
  { path: ['TopicArn'], forms: DEPLOYED_FORMS.topic },
];

const SERVICES: readonly Service[] = [
  {
    adapter: 'aws-eventbridge',
    // Many rules may match one event, and nothing queues it for them.
    channelKind: 'topic',
    kind: 'event',
    package: '@aws-sdk/client-eventbridge',
    client: 'EventBridgeClient',
    service: 'EventBridge',
    operations: [
      {
        command: 'PutEventsCommand',
        method: 'putEvents',
        // Each entry is an event of its own, and names its own bus.
        address: [
          { literal: AWS_SERVICE_PREFIX.eventbridge },
          { path: ['Entries', '*', 'EventBusName'], absent: DEFAULT_EVENT_BUS, forms: DEPLOYED_FORMS.bus },
          { path: ['Entries', '*', 'Source'] },
          { path: ['Entries', '*', 'DetailType'] },
        ],
        payload: ['Entries', '*', 'Detail'],
      },
    ],
  },
  {
    adapter: 'aws-sqs',
    channelKind: 'queue',
    kind: 'message',
    package: '@aws-sdk/client-sqs',
    client: 'SQSClient',
    service: 'SQS',
    operations: [
      { command: 'SendMessageCommand', method: 'sendMessage', address: QUEUE, payload: ['MessageBody'] },
      {
        command: 'SendMessageBatchCommand',
        method: 'sendMessageBatch',
        address: QUEUE,
        payload: ['Entries', '*', 'MessageBody'],
      },
    ],
  },
  {
    adapter: 'aws-sns',
    channelKind: 'topic',
    kind: 'message',
    package: '@aws-sdk/client-sns',
    client: 'SNSClient',
    service: 'SNS',
    operations: [
      { command: 'PublishCommand', method: 'publish', address: TOPIC, payload: ['Message'] },
      {
        command: 'PublishBatchCommand',
        method: 'publishBatch',
        address: TOPIC,
        payload: ['PublishBatchRequestEntries', '*', 'Message'],
      },
    ],
  },
];

/** A path into the input, as a locator for one shape of call. */
type InputLocator = (path: readonly string[]) => NameLocator;

const viaCommand =
  (command: string): InputLocator =>
  (path) => ({ kind: 'constructed-argument-path', class: command, path });

const viaInput: InputLocator = (path) => ({ kind: 'argument-path', index: 0, path });

const addressAt = (parts: readonly InputPart[], locate: InputLocator): AddressPart[] =>
  parts.map((part) =>
    'literal' in part
      ? part
      : {
          at: [locate(part.path)],
          ...(part.absent === undefined ? {} : { absent: part.absent }),
          ...(part.forms === undefined ? {} : { forms: part.forms }),
        },
  );

/** The two patterns one operation is read through: a command sent, and a method called. */
const patternsOf = (service: Service, operation: Operation): CallPattern[] => {
  const shapes: readonly { method: string; locate: InputLocator; receiverType: string[]; receiverPackages: string[] }[] = [
    {
      method: 'send',
      locate: viaCommand(operation.command),
      // The aggregated client sends commands too.
      receiverType: [service.client, service.service],
      receiverPackages: [service.package],
    },
    {
      method: operation.method,
      locate: viaInput,
      receiverType: [service.service],
      receiverPackages: [service.package, V2_PACKAGE],
    },
  ];
  return shapes.map(({ method, locate, receiverType, receiverPackages }) => ({
    method,
    channelArg: -1,
    address: addressAt(operation.address, locate),
    payload: [locate(operation.payload)],
    receiverType,
    receiverPackages,
    kind: service.kind,
  }));
};

/**
 * Whether any manifest of the repository declares one of the packages.
 *
 * The manifest at the root first. A repository of functions often keeps one
 * manifest per function, each declaring the clients that function uses and the
 * root declaring none, so the manifests below it are asked too.
 */
const declaredAnywhere = (pkg: PackageJson, names: readonly string[], repoDir: string | undefined): boolean =>
  hasAnyDependency(pkg, names) ||
  (repoDir !== undefined && manifestsWithin(repoDir).some((manifest) => hasAnyDependency(manifest, names)));

const specOf = (service: Service): BrokerSpec => ({
  name: service.adapter,
  detect: (pkg, _config, repoDir) => declaredAnywhere(pkg, [service.package, V2_PACKAGE], repoDir),
  producerPatterns: service.operations.flatMap((operation) => patternsOf(service, operation)),
  consumerDecorators: [],
  consumerPatterns: [],
  channelKind: service.channelKind,
});

export const awsBrokerAdapters: readonly BrokerSpec[] = SERVICES.map(specOf);
