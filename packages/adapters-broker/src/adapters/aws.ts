import {
  AWS_SERVICE_PREFIX,
  BUCKET_CHANNEL,
  BUCKET_FIELDS,
  CHANGES_CHANNELS,
  CHANGES_PREFIX,
  DEPLOYED_CHANNELS,
  DEPLOYED_FORMS,
  FUNCTION_NAME_FORMS,
  PRESIGNER,
  S3_UPLOAD,
  S3_WRITES,
  SDK_SENDS,
  SDK_WRITES,
  type SendingService,
  type WritingService,
} from '@flowatlas/aws';
import {
  EVERY_ELEMENT,
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
 *
 * Writing to a DynamoDB table and putting a record on a Kinesis stream are rows
 * too (P51): onto `dynamodb/<table>` and `kinesis/<stream>`, where the function
 * a mapping from that stream runs reads them. A table write is a publish only
 * where a deployment declares the table's stream, which no call says, so it is
 * drawn as one `whereDeclared` and the linker keeps or drops it.
 */

/** A part of an address, written against the operation's input rather than a call. */
type InputPart =
  | { readonly literal: string }
  | {
      readonly path: readonly string[];
      /** Further paths tried after it, in order, at each element. */
      readonly or?: readonly (readonly string[])[];
      readonly absent?: string;
      readonly forms?: readonly string[];
      readonly unwrittenIsNone?: boolean;
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
  /** The command class version 3 sends it as; absent for an operation only version 2 has. */
  readonly command?: string;
  /** The method both clients that take the input directly call it as. */
  readonly method: string;
  readonly address: readonly InputPart[];
  /** Where in the input the message is, for an operation that sends one or starts something with one. */
  readonly payload?: readonly string[];
  /** The operation hands its receivers no message of its own: a write to a bucket (P52). */
  readonly silent?: boolean;
  /** Fields of the input recorded on the publisher as written, by name. */
  readonly recorded?: Readonly<Record<string, readonly string[]>>;
  /** What it is recorded as, where that is not the service's word. */
  readonly kind?: string;
  readonly starts?: Starts;
  readonly whereDeclared?: boolean;
  /** Many messages or items in one round trip (P89). */
  readonly batch?: true;
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
  /** Calls of the service that are not an operation on its client: a helper of another package. */
  readonly helpers?: readonly CallPattern[];
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
      ...(operation.batch === true ? { batch: true as const } : {}),
    };
  });
};

/**
 * The operations that write to a bucket, each a publisher onto it recorded as
 * the event it fires there, with the key it writes, which a notification of the
 * bucket filters on (P52). A notification is handed the service's notice of
 * the write, never what was written, so no message is read.
 */
const BUCKET: readonly InputPart[] = [
  { literal: AWS_SERVICE_PREFIX.s3 },
  { path: [BUCKET_FIELDS.bucket], forms: DEPLOYED_FORMS.bucket },
];

const bucketWrites = (): Operation[] =>
  S3_WRITES.map((write) => ({
    ...(write.command === undefined ? {} : { command: write.command }),
    method: write.method,
    address: BUCKET,
    silent: true,
    recorded: {
      [BUCKET_FIELDS.key]: write.key ?? [BUCKET_FIELDS.key],
      ...(write.version === undefined ? {} : { [BUCKET_FIELDS.version]: write.version }),
    },
    kind: write.event,
  }));

/** A bucket written through a locator of the shape of call at hand. */
const bucketAt = (at: (path: readonly string[]) => NameLocator, receiverPackages: string[]): Pick<CallPattern, 'channelArg' | 'address' | 'payload' | 'recorded' | 'receiverPackages'> => ({
  channelArg: -1,
  address: [{ literal: AWS_SERVICE_PREFIX.s3 }, { at: [at([BUCKET_FIELDS.bucket])], forms: DEPLOYED_FORMS.bucket }],
  payload: [],
  recorded: { [BUCKET_FIELDS.key]: [at([BUCKET_FIELDS.key])] },
  receiverPackages,
});

/**
 * Two writes that are not an operation on the client: `@aws-sdk/lib-storage`'s
 * `Upload`, told where it writes when it is made and run by `done()`; and a
 * URL signed for a `PutObjectCommand`, which the browser it is handed writes
 * with - recorded as the signing, and drawn as a guess (P52).
 */
const BUCKET_HELPERS: readonly CallPattern[] = [
  {
    method: S3_UPLOAD.method,
    ...bucketAt((path) => ({ kind: 'receiver-constructed-path', class: S3_UPLOAD.class, path: [...S3_UPLOAD.input, ...path] }), [S3_UPLOAD.package]),
    receiverType: [S3_UPLOAD.class],
    kind: S3_UPLOAD.event,
  },
  {
    method: PRESIGNER.function,
    calledAs: 'function',
    module: PRESIGNER.package,
    ...bucketAt((path) => ({ kind: 'constructed-argument-path', class: PRESIGNER.command, path }), [PRESIGNER.package]),
    kind: PRESIGNER.event,
    guessed: PRESIGNER.guessed,
  },
];

/**
 * The operations that write to a table or put a record on a stream, written
 * against their input from the fields `@flowatlas/aws` states. A table's write
 * is one only where its stream is declared; a record put on a stream is always
 * on it.
 */
const writesTo = ({ changes, operations }: WritingService): Operation[] =>
  operations.map((operation) => {
    const [path = [], ...or] = operation.address;
    return {
      command: operation.command,
      method: operation.method,
      address: [
        { literal: CHANGES_PREFIX[changes] },
        {
          path,
          ...(or.length === 0 ? {} : { or }),
          forms: DEPLOYED_FORMS[changes],
          // An entry of a list that names none - a transaction's condition check - writes nothing.
          ...(path.includes(EVERY_ELEMENT) ? { unwrittenIsNone: true } : {}),
        },
      ],
      // A batch or a transaction writes many items, none of them the message (P55).
      ...(operation.message === undefined ? { silent: true } : { payload: operation.message }),
      ...(changes === 'table' ? { whereDeclared: true } : {}),
      ...(operation.batch === true ? { batch: true as const } : {}),
    };
  });

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
    ...BUCKET_CHANNEL,
    kind: 'object',
    package: '@aws-sdk/client-s3',
    client: 'S3Client',
    service: 'S3',
    operations: bucketWrites(),
    helpers: BUCKET_HELPERS,
  },
  {
    ...CHANGES_CHANNELS.table,
    package: '@aws-sdk/client-dynamodb',
    client: 'DynamoDBClient',
    service: 'DynamoDB',
    operations: writesTo(SDK_WRITES.table),
  },
  {
    ...CHANGES_CHANNELS.table,
    // One adapter per client: the document client is a description of its own.
    adapter: `${CHANGES_CHANNELS.table.adapter}-document`,
    package: '@aws-sdk/lib-dynamodb',
    client: 'DynamoDBDocumentClient',
    service: 'DynamoDBDocument',
    // `new AWS.DynamoDB.DocumentClient()` in version 2.
    v2Service: 'DocumentClient',
    operations: writesTo(SDK_WRITES.document),
  },
  {
    ...CHANGES_CHANNELS.stream,
    package: '@aws-sdk/client-kinesis',
    client: 'KinesisClient',
    service: 'Kinesis',
    operations: writesTo(SDK_WRITES.stream),
  },
  {
    adapter: 'aws-stepfunctions',
    kind: 'start',
    package: '@aws-sdk/client-sfn',
    client: 'SFNClient',
    service: 'SFN',
    v2Service: 'StepFunctions',
    operations: [
      {
        command: 'StartExecutionCommand',
        method: 'startExecution',
        address: STATE_MACHINE,
        payload: ['input'],
        starts: { entry: 'workflow' },
      },
      {
        command: 'StartSyncExecutionCommand',
        method: 'startSyncExecution',
        address: STATE_MACHINE,
        payload: ['input'],
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
        payload: ['Payload'],
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
          at: [part.path, ...(part.or ?? [])].map(locate),
          ...(part.absent === undefined ? {} : { absent: part.absent }),
          ...(part.forms === undefined ? {} : { forms: part.forms }),
          ...(part.unwrittenIsNone === true ? { unwrittenIsNone: true } : {}),
        },
  );

const startsAt = (starts: Starts, locate: InputLocator): StartedEntry => ({
  entry: starts.entry,
  ...(starts.kindAt === undefined ? {} : { kindAt: { at: [locate(starts.kindAt.path)], kinds: starts.kindAt.kinds } }),
  ...(starts.resumes === undefined ? {} : { resumes: starts.resumes }),
});

/** The two patterns one operation is read through: a command sent, and a method called. */
const patternsOf = (service: Service, operation: Operation): CallPattern[] => {
  const command = operation.command;
  const shapes: readonly { method: string; locate: InputLocator; receiverType: string[]; receiverPackages: string[] }[] = [
    ...(command === undefined
      ? []
      : [
          {
            method: 'send',
            locate: viaCommand(command),
            // The aggregated client sends commands too.
            receiverType: [service.client, service.service],
            receiverPackages: [service.package],
          },
        ]),
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
    ...(operation.silent === true ? { payload: [] } : operation.payload === undefined ? {} : { payload: [locate(operation.payload)] }),
    ...(operation.recorded === undefined
      ? {}
      : { recorded: Object.fromEntries(Object.entries(operation.recorded).map(([name, path]) => [name, [locate(path)]])) }),
    receiverType,
    receiverPackages,
    kind: operation.kind ?? service.kind,
    ...(operation.starts === undefined ? {} : { starts: startsAt(operation.starts, locate) }),
    ...(operation.whereDeclared === true ? { whereDeclared: true } : {}),
    ...(operation.batch === true ? { batch: true } : {}),
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
  producerPatterns: [...service.operations.flatMap((operation) => patternsOf(service, operation)), ...(service.helpers ?? [])],
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
