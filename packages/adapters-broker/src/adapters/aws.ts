import {
  AWS_SERVICE_PREFIX,
  DEPLOYED_CHANNELS,
  DEPLOYED_FORMS,
  FUNCTION_NAME_FORMS,
  SDK_SENDS,
  type SendingService,
} from '@flowatlas/aws';
import {
  hasAnyDependency,
  manifestsWithin,
  type AddressPart,
  type CallPattern,
  type ChannelKind,
  type DeployedEntryKind,
  type MessageTarget,
  type NameLocator,
  type PackageJson,
  type StartedEntry,
} from '@flowatlas/core';
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
 * Only publishing and starting are read here. Who receives - a rule, a subscription, a
 * mapping from a queue to a function - is declared in the deployment and not
 * in code, and is read from there. Both ends spell the channel in the grammar
 * `@flowatlas/aws` states, and read a `QueueUrl` or a `TopicArn` through the
 * forms it states, so they meet on one node.
 *
 * Starting a workflow and invoking a function are rows of the same table
 * (P24): an operation that `starts` reads its address as the deployed name of
 * an entry rather than of a channel, so the same three shapes of call, the
 * same locators and the same completion from the environment serve both.
 */

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

/**
 * The operations that send to a queue, a topic or a bus, written against their
 * input from the fields `@flowatlas/aws` states for every reader of the SDK, a
 * state machine's task among them. A field one entry of a batch carries is
 * found under each entry.
 */
const sendsTo = (target: MessageTarget['kind'], service: string): Operation[] => {
  const { address, addressed, absent, event, operations }: SendingService = SDK_SENDS[target];
  return operations.map((operation) => {
    const inEntry = (field: string): string[] =>
      operation.entries === undefined ? [field] : [operation.entries, '*', field];
    const named = (field: string): string[] => (addressed === 'entry' ? inEntry(field) : [field]);
    return {
      command: operation.command,
      method: operation.method,
      address: [
        { literal: service },
        { path: named(address), ...(absent === undefined ? {} : { absent }), forms: DEPLOYED_FORMS[target] },
        ...(event === undefined ? [] : [event.source, event.detailType].map((field) => ({ path: named(field) }))),
      ],
      payload: inEntry(operation.message),
    };
  });
};

const STATE_MACHINE: readonly InputPart[] = [{ path: ['stateMachineArn'], forms: DEPLOYED_FORMS.workflow }];

/** A task token names a waiting run, and no workflow: where it is read, nothing is. */
const TASK_TOKEN: readonly InputPart[] = [{ path: ['taskToken'] }];

const SERVICES: readonly Service[] = [
  {
    ...DEPLOYED_CHANNELS.bus,
    package: '@aws-sdk/client-eventbridge',
    client: 'EventBridgeClient',
    service: 'EventBridge',
    operations: sendsTo('bus', AWS_SERVICE_PREFIX.eventbridge),
  },
  {
    ...DEPLOYED_CHANNELS.queue,
    package: '@aws-sdk/client-sqs',
    client: 'SQSClient',
    service: 'SQS',
    operations: sendsTo('queue', AWS_SERVICE_PREFIX.sqs),
  },
  {
    ...DEPLOYED_CHANNELS.topic,
    package: '@aws-sdk/client-sns',
    client: 'SNSClient',
    service: 'SNS',
    operations: sendsTo('topic', AWS_SERVICE_PREFIX.sns),
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
        address: [{ path: ['FunctionName'], forms: [...DEPLOYED_FORMS.function, ...FUNCTION_NAME_FORMS] }],
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

/**
 * The clients of this table that start something by its deployed name, for a
 * reader asking whether a package's declared types reach one (R171): the
 * version 3 package, and the class version 2 names the service by, with the
 * module of that one client alone.
 */
export interface StartingClient {
  readonly entry: DeployedEntryKind;
  readonly client: string;
  readonly package: string;
  readonly v2: { readonly package: string; readonly name: string; readonly module: string };
}

export const STARTING_CLIENTS: readonly StartingClient[] = SERVICES.flatMap((service) => {
  const starts = service.operations.find((operation) => operation.starts !== undefined && operation.starts.resumes !== true)?.starts;
  if (starts === undefined) return [];
  const name = service.v2Service ?? service.service;
  return [
    {
      entry: starts.entry,
      client: service.client,
      package: service.package,
      v2: { package: V2_PACKAGE, name, module: `${V2_PACKAGE}/clients/${name.toLowerCase()}` },
    },
  ];
});
