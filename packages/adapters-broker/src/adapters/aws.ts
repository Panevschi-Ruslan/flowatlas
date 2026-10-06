import {
  hasAnyDependency,
  manifestsWithin,
  type AddressPart,
  type CallPattern,
  type ChannelKind,
  type DeployedEntryKind,
  type ChannelPattern,
  type MessagePattern,
  type MessageTarget,
  type NameLocator,
  type PackageJson,
  type StartedEntry,
} from '@flowatlas/core';
import { ADDRESS_SEPARATOR } from '../address.js';
import type { BrokerSpec } from './types.js';

/**
 * The AWS SDK's three messaging clients, and the two that start something by
 * its deployed name, as descriptions.
 *
 * Each operation is a row: the command it is sent as, the method it is called
 * as, where its input names the address and where it carries the message. The
 * rows are compiled into the same patterns a description in configuration
 * compiles into, using the same locators a person can write there -
 * `constructed-argument-path` for a command, `argument-path` for a method's
 * input - so the SDK is read by nothing a project wrapping it could not describe
 * for itself. What configuration cannot say is a publisher's
 * `receiverPackages` - `broker.custom` names a client by its class alone - and,
 * of a start, which value of the input makes it one nobody waits for, or that
 * it answers a waiting run rather than starting one.
 *
 * Three shapes of call reach each operation, and every row reads all three:
 *
 * - `client.send(new PutEventsCommand(input))`, version 3, with the command
 *   built in the call or in a constant before it;
 * - `client.putEvents(input)`, version 3's aggregated client;
 * - `service.putEvents(input).promise()`, version 2 - the same method, the same
 *   input, the client declared in `aws-sdk`.
 *
 * Only publishing and starting are read here. Who receives - a rule, a
 * subscription, a mapping from a queue to a function - is declared in the
 * deployment and not in code, and is read from there.
 *
 * Starting a workflow and invoking a function are rows of the same table
 * (P24): an operation that `starts` reads its address as the deployed name of
 * an entry rather than of a channel, so the same three shapes of call, the
 * same locators and the same completion from the environment serve both.
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
  // Any version or alias after the name is dropped: the name is what is deployed.
  stateMachine: ['^arn:[^:]+:states:[^:]*:[^:]*:stateMachine:([^:]+)(?::[^:]+)?$'],
  function: [
    '^arn:[^:]+:lambda:[^:]*:[^:]*:function:([^:]+)(?::[^:]+)?$',
    '^(?:[^:]+:)?function:([^:]+)(?::[^:]+)?$',
    '^([^:]+):[^:]+$',
  ],
} as const;

export const queueChannel = (name: string): string =>
  [AWS_SERVICE_PREFIX.sqs, name].join(ADDRESS_SEPARATOR);

export const topicChannel = (name: string): string =>
  [AWS_SERVICE_PREFIX.sns, name].join(ADDRESS_SEPARATOR);

export const eventChannel = (bus: string | undefined, source: string, detailType: string): string =>
  [AWS_SERVICE_PREFIX.eventbridge, bus ?? DEFAULT_EVENT_BUS, source, detailType].join(ADDRESS_SEPARATOR);

/**
 * The two fields of an event its channel is named by, as an event pattern
 * spells them. Every other field a pattern filters on - `detail`, `account`,
 * `resources` - is recorded and not matched on (P23).
 */
export const EVENT_NAME_FIELDS = ['source', 'detail-type'] as const;

/**
 * The channel a message sent to a deployed target lands on, in the grammar
 * above; `undefined` for an event whose fields do not name one exactly.
 */
export const channelOfTarget = (target: MessageTarget): string | undefined => {
  switch (target.kind) {
    case 'queue':
      return queueChannel(target.name);
    case 'topic':
      return topicChannel(target.name);
    case 'bus': {
      const [source, detailType] = EVENT_NAME_FIELDS.map((field) => target.fields?.[field]);
      return source === undefined || detailType === undefined ? undefined : eventChannel(target.name, source, detailType);
    }
  }
};

/**
 * Events on a bus that a pattern selects, as a pattern over channel names.
 *
 * The parts are the grammar's: the service, the bus, the source, the detail
 * type. A field the pattern does not filter matches any value.
 */
export const eventChannelPattern = (bus: string, pattern: MessagePattern): ChannelPattern => ({
  parts: [
    { name: 'service', filters: [{ equals: AWS_SERVICE_PREFIX.eventbridge }] },
    { name: 'bus', filters: [{ equals: bus }] },
    ...EVENT_NAME_FIELDS.map((field) => ({ name: field, filters: pattern.fields[field] ?? [] })),
  ],
});

/** The adapter and the kind of channel a deployed queue, topic or bus is read as. */
// Many rules may match one event, and nothing queues it for them: a bus is a topic.
export const DEPLOYED_CHANNELS: Readonly<Record<MessageTarget['kind'], { adapter: string; channelKind: ChannelKind }>> = {
  queue: { adapter: 'aws-sqs', channelKind: 'queue' },
  topic: { adapter: 'aws-sns', channelKind: 'topic' },
  bus: { adapter: 'aws-eventbridge', channelKind: 'topic' },
};

/** A part of an address, written against the operation's input rather than a call. */
type InputPart =
  | { readonly literal: string }
  | {
      readonly path: readonly string[];
      readonly absent?: string;
      readonly forms?: readonly string[];
    };

/** What an operation that starts something starts, written against its input. */
interface Starts {
  readonly entry: DeployedEntryKind;
  /** Where the input says whether the caller waits, and the kind each value makes the call. */
  readonly kindAt?: { readonly path: readonly string[]; readonly kinds: Readonly<Record<string, string>> };
  readonly resumes?: boolean;
}

/** One operation that publishes, or starts something. */
interface Operation {
  /** The command class version 3 sends it as. */
  readonly command: string;
  /** The method both clients that take the input directly call it as. */
  readonly method: string;
  readonly address: readonly InputPart[];
  /** Where in the input the message is, for an operation that sends one. */
  readonly payload?: readonly string[];
  /** What it is recorded as, where that is not the service's word. */
  readonly kind?: string;
  readonly starts?: Starts;
}

/** One service: its package, its clients, and what it publishes or starts. */
interface Service {
  readonly adapter: string;
  /** Absent for a service that publishes to no channel at all. */
  readonly channelKind?: ChannelKind;
  /** What a publish is recorded as. */
  readonly kind: string;
  /** The version 3 package. */
  readonly package: string;
  /** The version 3 client that sends commands. */
  readonly client: string;
  /** The class version 3's aggregated client and version 2's client share. */
  readonly service: string;
  /** The class version 2 names the service by, where it is not version 3's. */
  readonly v2Service?: string;
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

const STATE_MACHINE: readonly InputPart[] = [{ path: ['stateMachineArn'], forms: DEPLOYED_FORMS.stateMachine }];

/** A task token names a waiting run, and no workflow: where it is read, nothing is. */
const TASK_TOKEN: readonly InputPart[] = [{ path: ['taskToken'] }];

const SERVICES: readonly Service[] = [
  {
    ...DEPLOYED_CHANNELS.bus,
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
    ...DEPLOYED_CHANNELS.queue,
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
    ...DEPLOYED_CHANNELS.topic,
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
  {
    adapter: 'aws-stepfunctions',
    kind: 'start',
    package: '@aws-sdk/client-sfn',
    client: 'SFNClient',
    service: 'SFN',
    v2Service: 'StepFunctions',
    operations: [
      { command: 'StartExecutionCommand', method: 'startExecution', address: STATE_MACHINE, starts: { entry: 'workflow' } },
      {
        command: 'StartSyncExecutionCommand',
        method: 'startSyncExecution',
        address: STATE_MACHINE,
        kind: 'start-sync',
        starts: { entry: 'workflow' },
      },
      {
        command: 'SendTaskSuccessCommand',
        method: 'sendTaskSuccess',
        address: TASK_TOKEN,
        kind: 'task-success',
        starts: { entry: 'workflow', resumes: true },
      },
      {
        command: 'SendTaskFailureCommand',
        method: 'sendTaskFailure',
        address: TASK_TOKEN,
        kind: 'task-failure',
        starts: { entry: 'workflow', resumes: true },
      },
    ],
  },
  {
    adapter: 'aws-lambda-invoke',
    kind: 'invoke',
    package: '@aws-sdk/client-lambda',
    client: 'LambdaClient',
    service: 'Lambda',
    operations: [
      {
        command: 'InvokeCommand',
        method: 'invoke',
        address: [{ path: ['FunctionName'], forms: DEPLOYED_FORMS.function }],
        // Left out, the caller waits for the answer; `Event` hands the call over and returns.
        starts: { entry: 'invoke', kindAt: { path: ['InvocationType'], kinds: { Event: 'invoke-async', DryRun: 'invoke-dry-run' } } },
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

const startsAt = (starts: Starts, locate: InputLocator): StartedEntry => ({
  entry: starts.entry,
  ...(starts.kindAt === undefined ? {} : { kindAt: { at: [locate(starts.kindAt.path)], kinds: starts.kindAt.kinds } }),
  ...(starts.resumes === undefined ? {} : { resumes: starts.resumes }),
});

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
      receiverType: [service.service, ...(service.v2Service === undefined ? [] : [service.v2Service])],
      receiverPackages: [service.package, V2_PACKAGE],
    },
  ];
  return shapes.map(({ method, locate, receiverType, receiverPackages }) => ({
    method,
    channelArg: -1,
    address: addressAt(operation.address, locate),
    ...(operation.payload === undefined ? {} : { payload: [locate(operation.payload)] }),
    receiverType,
    receiverPackages,
    kind: operation.kind ?? service.kind,
    ...(operation.starts === undefined ? {} : { starts: startsAt(operation.starts, locate) }),
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
  // A service that only starts things names no channel, and this is never read.
  channelKind: service.channelKind ?? 'channel',
});

export const awsBrokerAdapters: readonly BrokerSpec[] = SERVICES.map(specOf);
