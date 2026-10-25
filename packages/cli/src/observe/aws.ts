import {
  AWS_SERVICE_PREFIX,
  bucketChannel,
  changesChannel,
  DEFAULT_EVENT_BUS,
  deployedNameIn,
  FUNCTION_NAME_FORMS,
  queueChannel,
  S3_WRITES,
  SDK_SENDS,
  SDK_WRITES,
  topicChannel,
} from '@flowatlas/aws';
import { ADDRESS_SEPARATOR, nameInForms, type DeployedKind } from '@flowatlas/core';
import type { AwsTransport, FaasTrigger, ObservedSpan } from './span.js';

/**
 * The words a span from AWS uses (P107), read into the names the static map
 * already draws.
 *
 * An OpenTelemetry-instrumented Lambda function, or the AWS Distro's layer,
 * names the function it runs in (`faas.name`, or an ARN in
 * `cloud.resource_id`), the workflow and step it is (`aws.step_functions.*`),
 * and every SDK call it makes as `rpc.system=aws-api` with `rpc.service` and
 * `rpc.method`, with a few attributes per service saying what it called. The
 * map names the same things by the names they are deployed under, so every
 * ARN and URL here is cut to the name inside it with the forms
 * `@flowatlas/aws` reads deployments with (`deployedNameIn`), and a channel is
 * spelled with the functions the readers spell it with (`channelLabelOf`).
 *
 * Nothing account- or region-shaped survives: a name is kept only when it
 * came out of a form, or was a bare name to begin with. No request parameter
 * - a key, an item, a message body, a workflow's input - is ever read.
 */

/** The attributes of one span, its resource's beneath them: names to strings, and the few lists read. */
export interface SpanAttributes {
  readonly text: ReadonlyMap<string, string>;
  readonly lists: ReadonlyMap<string, readonly string[]>;
}

/** How a span of one service is found on the map. */
export type AwsLookup = 'table' | 'channel' | 'invoke' | 'workflow';

/** One AWS service, as a Strategy: how its span is read, and what it is looked up as. */
export interface AwsCall {
  readonly lookup: AwsLookup;
  /** The service whose channels a destination is spelled for. */
  readonly transport?: AwsTransport;
  /**
   * The operations that send, write or start: a span of one of them is the
   * caller's end of a join. Any other operation of the service (a read, a
   * receive, a describe) is seen and credited to nothing.
   */
  readonly sends: ReadonlySet<string>;
  /** What the span names, from its attributes; never a request parameter. */
  read(attrs: SpanAttributes): Partial<ObservedSpan>;
}

/** `putItem` as an operation is spelled on a span: `PutItem`. */
const operationOf = (method: string): string => method.charAt(0).toUpperCase() + method.slice(1);

const operations = (methods: readonly { method: string }[]): ReadonlySet<string> =>
  new Set(methods.map(({ method }) => operationOf(method)));

/**
 * The name of a deployed thing as written in `text`: the name inside an ARN or
 * URL of that kind, or the text itself when it is a bare name. Anything else
 * - an ARN of another kind, a URL no form reads - is not a name, and is
 * dropped rather than kept with an account inside it.
 */
export const deployedName = (kind: DeployedKind, text: string | undefined): string | undefined => {
  if (text === undefined || text === '') return undefined;
  const found = deployedNameIn(text);
  if (found !== undefined) return found.kind === kind ? found.name : undefined;
  return /[:/]/.test(text) ? undefined : text;
};

/** The name inside an ARN of `kind`, and nothing for any other text: what `cloud.resource_id` holds. */
const arnName = (kind: DeployedKind, text: string | undefined): string | undefined => {
  const found = text === undefined ? undefined : deployedNameIn(text);
  return found?.kind === kind ? found.name : undefined;
};

/** A row of a table keyed by a word a span says, never a property every object has. */
const own = <V>(table: Readonly<Record<string, V>>, key: string | undefined): V | undefined =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

/** A function as Lambda's `FunctionName` takes it: a name, an ARN, or either with a version or alias. */
export const functionName = (text: string | undefined): string | undefined =>
  deployedName('function', text) ?? (text === undefined ? undefined : nameInForms(text, FUNCTION_NAME_FORMS));

/**
 * A workflow execution's ARN, standard or express: the workflow it ran and
 * the execution's own name. The account and the region in it are not kept.
 */
const EXECUTION_FORM = /^arn:[^:]+:states:[^:]*:[^:]*:(?:execution|express):([^:]+):([^:]+)(?::[^:]+)?$/;

export const executionIn = (text: string | undefined): { workflow: string; name: string } | undefined => {
  const found = text === undefined ? null : EXECUTION_FORM.exec(text);
  return found === null ? undefined : { workflow: found[1]!, name: found[2]! };
};

/** The workflow a state machine's ARN (an alias or a version cut), an execution's ARN, or a bare name names. */
export const workflowName = (text: string | undefined): string | undefined =>
  executionIn(text)?.workflow ?? deployedName('workflow', text);

const first = (attrs: SpanAttributes, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = attrs.text.get(key);
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
};

/** The first of `keys` that holds a name of `kind`. */
const nameAt = (attrs: SpanAttributes, kind: DeployedKind, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const name = deployedName(kind, attrs.text.get(key));
    if (name !== undefined) return name;
  }
  return undefined;
};

const DESTINATION = ['messaging.destination.name', 'messaging.destination'];

const destinationOf = (kind: DeployedKind, keys: readonly string[]) => (attrs: SpanAttributes): Partial<ObservedSpan> => ({
  destination: nameAt(attrs, kind, [...keys, ...DESTINATION]),
});

/** A table's name from an ARN or a bare name; a stream's ARN names its table too. */
const tableName = (text: string): string | undefined => {
  const found = deployedNameIn(text);
  if (found !== undefined) return found.kind === 'table' ? found.name : undefined;
  return /[:/]/.test(text) ? undefined : text;
};

/**
 * Every AWS service whose spans are matched, by `rpc.service` as the SDK
 * names it. A service off this table is counted by `<service>/<method>`
 * only (the `cloud` unmatched kind), which says what a function talks to
 * without any of what it said.
 */
export const AWS_CALLS: Readonly<Record<string, AwsCall>> = {
  DynamoDB: {
    lookup: 'table',
    transport: 'dynamodb',
    sends: operations(SDK_WRITES.table.operations),
    read: (attrs) => {
      const tables = (attrs.lists.get('aws.dynamodb.table_names') ?? []).flatMap((name) => tableName(name) ?? []);
      return tables.length === 0 ? {} : { tables: [...new Set(tables)] };
    },
  },
  SQS: {
    lookup: 'channel',
    transport: 'sqs',
    sends: operations(SDK_SENDS.queue.operations),
    read: destinationOf('queue', ['aws.sqs.queue.url', 'aws.sqs.queue_url']),
  },
  SNS: {
    lookup: 'channel',
    transport: 'sns',
    sends: operations(SDK_SENDS.topic.operations),
    read: destinationOf('topic', ['aws.sns.topic.arn', 'aws.sns.topic_arn']),
  },
  EventBridge: {
    lookup: 'channel',
    transport: 'eventbridge',
    sends: operations(SDK_SENDS.bus.operations),
    // A span names the bus and seldom the event: the one the entry leaves out is `default`.
    read: (attrs) => ({ destination: nameAt(attrs, 'bus', ['aws.eventbridge.bus_name']) ?? DEFAULT_EVENT_BUS }),
  },
  Kinesis: {
    lookup: 'channel',
    transport: 'kinesis',
    sends: operations(SDK_WRITES.stream.operations),
    read: destinationOf('stream', ['aws.kinesis.stream_name']),
  },
  S3: {
    lookup: 'channel',
    transport: 's3',
    // `upload` is `@aws-sdk/lib-storage`'s, which sends the multipart commands.
    sends: operations(S3_WRITES.filter((write) => write.command !== undefined)),
    read: destinationOf('bucket', ['aws.s3.bucket']),
  },
  Lambda: {
    lookup: 'invoke',
    sends: new Set(['Invoke', 'InvokeAsync']),
    read: (attrs) => ({ invokes: functionName(first(attrs, ['faas.invoked_name', 'aws.lambda.function.name'])) }),
  },
  SFN: {
    lookup: 'workflow',
    sends: new Set(['StartExecution', 'StartSyncExecution']),
    read: (attrs) => ({ workflow: nameAt(attrs, 'workflow', ['aws.step_functions.state_machine.arn']) }),
  },
};

/** What `messaging.system` says a destination is spelled for. */
const MESSAGING_TRANSPORTS: Readonly<Record<string, AwsTransport>> = {
  aws_sqs: 'sqs',
  'aws.sqs': 'sqs',
  aws_sns: 'sns',
  'aws.sns': 'sns',
};

const TRIGGERS: ReadonlySet<FaasTrigger> = new Set(['http', 'pubsub', 'datasource', 'timer', 'other']);

/** The longest a step name is allowed to be, by the States language. */
const STATE_NAME_MAX = 80;

/** The span names a deployed function, a workflow, or an AWS call: `readAwsSpan` has something to read. */
export const isAwsSpan = (attrs: SpanAttributes): boolean =>
  attrs.text.get('rpc.system') === 'aws-api' ||
  own(MESSAGING_TRANSPORTS, attrs.text.get('messaging.system')) !== undefined ||
  [...attrs.text.keys(), ...attrs.lists.keys()].some(
    (key) => key.startsWith('faas.') || key.startsWith('aws.') || key === 'cloud.resource_id',
  );

/**
 * The fields an AWS span adds to its `ObservedSpan`, every one a deployed
 * name or a fixed word. The function comes from `faas.name`, else the
 * function ARN in `cloud.resource_id` (alias or version cut by the ARN form),
 * else `aws.lambda.invoked_arn`; the workflow from the state machine's ARN.
 * An SDK call's own fields come from its row in `AWS_CALLS`.
 */
export const readAwsSpan = (attrs: SpanAttributes): Partial<ObservedSpan> => {
  const resource = attrs.text.get('cloud.resource_id');
  const trigger = attrs.text.get('faas.trigger') as FaasTrigger | undefined;
  const state = attrs.text.get('aws.step_functions.state.name');
  const fields: Partial<ObservedSpan> = {
    faas:
      deployedName('function', attrs.text.get('faas.name')) ??
      arnName('function', resource) ??
      arnName('function', attrs.text.get('aws.lambda.invoked_arn')),
    trigger: trigger !== undefined && TRIGGERS.has(trigger) ? trigger : undefined,
    workflow: nameAt(attrs, 'workflow', ['aws.step_functions.state_machine.arn']) ?? arnName('workflow', resource),
    state: state !== undefined && state.length <= STATE_NAME_MAX ? state : undefined,
  };
  const messaging = own(MESSAGING_TRANSPORTS, attrs.text.get('messaging.system'));
  if (attrs.text.get('rpc.system') === 'aws-api') {
    const call = own(AWS_CALLS, attrs.text.get('rpc.service'));
    fields.awsOp = attrs.text.get('rpc.method');
    if (call !== undefined) Object.assign(fields, call.read(attrs), { transport: call.transport ?? messaging });
  } else if (messaging !== undefined) {
    fields.transport = messaging;
    fields.destination = nameAt(attrs, messaging === 'sqs' ? 'queue' : 'topic', [
      ...(messaging === 'sqs' ? ['aws.sqs.queue.url', 'aws.sqs.queue_url'] : ['aws.sns.topic.arn', 'aws.sns.topic_arn']),
      ...DESTINATION,
    ]);
  }
  return fields;
};

/**
 * A destination as any span may say it, with nothing account- or
 * region-shaped left: an ARN or a URL is the name inside it when a form reads
 * one, and is dropped when none does. A plain name is kept as it is.
 */
export const destinationName = (text: string | undefined): string | undefined => {
  if (text === undefined || !/^arn:|:\/\//.test(text)) return text;
  return deployedNameIn(text)?.name;
};

/** The row of `AWS_CALLS` a span is a call of, when it is one. */
export const awsCallOf = (span: Pick<ObservedSpan, 'rpc' | 'awsOp'>): AwsCall | undefined =>
  span.awsOp === undefined || span.rpc === undefined ? undefined : own(AWS_CALLS, span.rpc.split('/')[0]);

/** The span sends, writes or starts something: the caller's end of a join. */
export const sendsOf = (span: Pick<ObservedSpan, 'rpc' | 'awsOp'>): boolean =>
  span.awsOp !== undefined && (awsCallOf(span)?.sends.has(span.awsOp) ?? false);

/** How each transport's channel is spelled, by the readers' own functions. */
const SPELLED: Readonly<Record<Exclude<AwsTransport, 'eventbridge'>, (name: string) => string>> = {
  sqs: queueChannel,
  sns: topicChannel,
  s3: bucketChannel,
  kinesis: (name) => changesChannel('stream', name),
  dynamodb: (name) => changesChannel('table', name),
};

/**
 * The channel a span's destination is on, as the map spells it: `order-placed`
 * seen on an SQS span is `sqs/order-placed`. A destination with no transport
 * is the name as seen; an EventBridge span names a bus, not one channel, and
 * has none here (`eventBusPrefixOf`).
 */
export const channelLabelOf = (span: Pick<ObservedSpan, 'destination' | 'transport'>): string | undefined => {
  if (span.destination === undefined) return undefined;
  if (span.transport === undefined) return span.destination;
  return span.transport === 'eventbridge' ? undefined : SPELLED[span.transport](span.destination);
};

/** The channel a write to `table` lands on, when the table's stream is read. */
export const tableChannelOf = (table: string): string => SPELLED.dynamodb(table);

/** What every channel on the bus an EventBridge span names starts with: `eventbridge/<bus>/`. */
export const eventBusPrefixOf = (span: Pick<ObservedSpan, 'destination' | 'transport'>): string | undefined =>
  span.transport === 'eventbridge' && span.destination !== undefined
    ? [AWS_SERVICE_PREFIX.eventbridge, span.destination, ''].join(ADDRESS_SEPARATOR)
    : undefined;
