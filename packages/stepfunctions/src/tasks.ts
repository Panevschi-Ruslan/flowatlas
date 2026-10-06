import { DEFAULT_EVENT_BUS } from '@flowatlas/aws';
import type { DbOp, MessageTarget } from '@flowatlas/core';
import type { State } from './definition.js';
import {
  eventBusName,
  functionName,
  nameIn,
  NO_TEMPLATE_VALUES,
  parametersOf,
  queueName,
  readText,
  stateMachineName,
  tableName,
  topicName,
  type ParameterReader,
  type Reading,
  type TemplateValues,
} from './values.js';

/**
 * What a `Task` state does, read from its `Resource` and its parameters.
 *
 * The `Resource` says which service integration runs the task and how the state
 * waits for it; the parameters say what it is run on. What it is run on is the
 * part that joins - a function, another state machine, a queue, a table - and
 * each service spells it in a field of its own, so there is one classifier per
 * service and a registry that finds it by the service the `Resource` names. A
 * service with no classifier, or an action its classifier does not know, is
 * still a step: it is read as a call on that service and that action, so the
 * graph shows it even though it joins nothing.
 */

/**
 * How the state waits for its task, as the `Resource` suffix says.
 *
 * `request-response` returns when the call does; `sync` and `sync:2` wait for
 * the job the call started to finish; `wait-for-task-token` waits until
 * something hands the token back.
 */
export type Pattern = 'request-response' | 'sync' | 'sync:2' | 'wait-for-task-token';

const PATTERN_OF_SUFFIX: Readonly<Record<string, Pattern>> = {
  '': 'request-response',
  sync: 'sync',
  'sync:2': 'sync:2',
  waitForTaskToken: 'wait-for-task-token',
};

/** A service integration, as `arn:aws:states:::<service>:<action>[.<suffix>]` names it. */
export interface IntegrationCall {
  /** As the `Resource` writes it: `lambda`, `dynamodb`, `sqs`. */
  readonly service: string;
  readonly action: string;
  readonly pattern: Pattern;
  /** `arn:aws:states:::aws-sdk:...`: the SDK integration rather than the optimised one. */
  readonly sdk: boolean;
}

/** Where a message goes: a queue or topic by name, an event bus with what is put on it. */
export interface ChannelTarget {
  readonly name: Reading;
  readonly source?: Reading;
  readonly detailType?: Reading;
  /** The message, as the field that carries it is written: `{ "MessageBody.$": "$.notice" }`. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** What a task runs on, read from its parameters or its `Resource`. */
export type TaskTarget =
  | { readonly kind: 'function'; readonly name: Reading }
  | { readonly kind: 'workflow'; readonly name: Reading }
  | {
      readonly kind: 'channel';
      /** What it sends to, as a deployment names the same thing. */
      readonly transport: MessageTarget['kind'];
      readonly targets: readonly ChannelTarget[];
    }
  | { readonly kind: 'table'; readonly op: DbOp; readonly tables: readonly Reading[] }
  /** A call on a service that names nothing this tool joins: the step is the whole of it. */
  | { readonly kind: 'service' }
  | { readonly kind: 'activity'; readonly name: Reading }
  | {
      readonly kind: 'unknown';
      /** Read and not recognised as any resource, or not read at all. */
      readonly resource: Reading;
    };

/**
 * A task: what it runs on, and the integration that runs it.
 *
 * `call` is absent where the `Resource` is not an integration at all - a
 * function or an activity named by its own ARN.
 */
export type Task = TaskTarget & { readonly call?: IntegrationCall };

/** The kinds of target, for counting them. */
export type TaskTargetKind = TaskTarget['kind'];

export interface TaskClassifier {
  /** Services it answers for, as a `Resource` names them - optimised and SDK both. */
  readonly services: readonly string[];
  /**
   * What the task does, or `undefined` for an action this classifier does not
   * know, which is then read as a plain call on the service.
   */
  classify(call: IntegrationCall, parameters: ParameterReader): TaskTarget | undefined;
}

/** Action names compared without case: the two integrations spell some of them differently. */
const actionIs =
  (...names: readonly string[]) =>
  (call: IntegrationCall): boolean =>
    names.some((name) => name.toLowerCase() === call.action.toLowerCase());

const functions: TaskClassifier = {
  services: ['lambda'],
  classify: (call, parameters) =>
    actionIs('invoke')(call)
      ? { kind: 'function', name: nameIn(parameters.read('FunctionName'), functionName) }
      : undefined,
};

const workflows: TaskClassifier = {
  // `states` in the optimised integration, `sfn` in the SDK one.
  services: ['states', 'sfn'],
  classify: (call, parameters) =>
    actionIs('startExecution', 'startSyncExecution')(call)
      ? { kind: 'workflow', name: nameIn(parameters.read('StateMachineArn'), stateMachineName) }
      : undefined,
};

/**
 * Sending to a queue and publishing to a topic, as one description each.
 *
 * Both name their channel in one field and differ only in which field and how a
 * name is cut out of it, so they are rows of a table rather than two classifiers
 * that would have to be kept alike by hand. Each action carries its message in a
 * field of its own: the message, or the list of entries a batch sends.
 */
const SENDS: ReadonlyArray<{
  readonly services: readonly string[];
  readonly transport: 'queue' | 'topic';
  /** Each action that sends, and the field its message is in. */
  readonly actions: Readonly<Record<string, string>>;
  readonly field: string;
  readonly name: (text: string) => string | undefined;
}> = [
  {
    services: ['sqs'],
    transport: 'queue',
    actions: { sendMessage: 'MessageBody', sendMessageBatch: 'Entries' },
    field: 'QueueUrl',
    name: queueName,
  },
  {
    services: ['sns'],
    transport: 'topic',
    actions: { publish: 'Message', publishBatch: 'PublishBatchRequestEntries' },
    field: 'TopicArn',
    name: topicName,
  },
];

const sends: readonly TaskClassifier[] = SENDS.map((send) => ({
  services: send.services,
  classify: (call, parameters) => {
    const payload = Object.entries(send.actions).find(([action]) => actionIs(action)(call))?.[1];
    if (payload === undefined) return undefined;
    const written = parameters.written(payload);
    return {
      kind: 'channel',
      transport: send.transport,
      targets: [{ name: nameIn(parameters.read(send.field), send.name), ...(written === undefined ? {} : { payload: written }) }],
    };
  },
}));

/** The default bus, named explicitly so an entry that leaves the bus out still names one. */
const DEFAULT_BUS: Reading = { read: true, value: DEFAULT_EVENT_BUS, written: '' };

const events: TaskClassifier = {
  services: ['events', 'eventbridge'],
  classify: (call, parameters) => {
    if (!actionIs('putEvents')(call)) return undefined;
    const entries = parameters.raw('Entries');
    const target = (entry: unknown): ChannelTarget => {
      const bus = parameters.read('EventBusName', entry);
      const payload = parameters.written('Detail', entry);
      return {
        name: bus.read === false && bus.cause === 'absent' ? DEFAULT_BUS : nameIn(bus, eventBusName),
        source: parameters.read('Source', entry),
        detailType: parameters.read('DetailType', entry),
        ...(payload === undefined ? {} : { payload }),
      };
    };
    return {
      kind: 'channel',
      transport: 'bus',
      // A list written out is one channel per entry; anything else - a path
      // under `Entries.$`, an expression - is one target nobody could read.
      targets: Array.isArray(entries) ? entries.map(target) : [{ name: parameters.read('Entries') }],
    };
  },
};

/** What each item operation does to its table. */
const ITEM_OPERATIONS: Readonly<Record<string, DbOp>> = {
  getitem: 'read',
  query: 'read',
  scan: 'read',
  batchgetitem: 'read',
  transactgetitems: 'read',
  putitem: 'write',
  updateitem: 'write',
  batchwriteitem: 'write',
  transactwriteitems: 'write',
  deleteitem: 'delete',
};

/** The table names an item operation writes: one field, the keys of a batch, or one per transaction item. */
const tablesOf = (parameters: ParameterReader): Reading[] => {
  const batch = parameters.raw('RequestItems');
  if (typeof batch === 'object' && batch !== null && !Array.isArray(batch)) {
    // A key ending in `.$` evaluates its value; the table it names is still the key.
    return Object.keys(batch).map((key) => readText(key.replace(/\.\$$/, '')));
  }
  const items = parameters.raw('TransactItems');
  if (Array.isArray(items)) {
    return items.flatMap((item) =>
      typeof item === 'object' && item !== null
        ? Object.values(item as Record<string, unknown>).map((operation) => parameters.read('TableName', operation))
        : [],
    );
  }
  return [parameters.read('TableName')];
};

const tables: TaskClassifier = {
  services: ['dynamodb'],
  classify: (call, parameters) => {
    const op = ITEM_OPERATIONS[call.action.toLowerCase()];
    if (op === undefined) return undefined;
    return { kind: 'table', op, tables: tablesOf(parameters).map((reading) => nameIn(reading, tableName)) };
  },
};

/**
 * Every classifier, in no particular order: each answers for its own services
 * and no two answer for the same one.
 */
export const TASK_CLASSIFIERS: readonly TaskClassifier[] = [functions, workflows, ...sends, events, tables];

/**
 * The registry: a service's name to the one classifier that reads it.
 *
 * A `Map`, because the service is a word out of somebody's definition, and an
 * object would answer `constructor` with a function (R134).
 */
const BY_SERVICE: ReadonlyMap<string, TaskClassifier> = (() => {
  const registry = new Map<string, TaskClassifier>();
  for (const classifier of TASK_CLASSIFIERS) {
    for (const service of classifier.services) {
      if (registry.has(service)) throw new Error(`two task classifiers answer for ${service}`);
      registry.set(service, classifier);
    }
  }
  return registry;
})();

/** `arn:aws:states:::[aws-sdk:]<service>:<action>[.<suffix>]` */
const INTEGRATION = /^arn:[^:]+:states:::(aws-sdk:)?([A-Za-z0-9-]+):([A-Za-z0-9]+)(?:\.(sync(?::2)?|waitForTaskToken))?$/;

/** `arn:aws:lambda:<region>:<account>:function:<name>`: the function itself as the resource. */
const FUNCTION_RESOURCE = /^arn:[^:]+:lambda:/;

/**
 * `arn:aws:states:<region>:<account>:activity:<name>`: a worker polls for it.
 * Region and account may be placeholders, and a placeholder may hold a colon.
 */
const ACTIVITY_RESOURCE = /^arn:[^:]+:states:.*:activity:/;

const activityName = (text: string): string | undefined => /:activity:([A-Za-z0-9_\uE000-]+)$/.exec(text)?.[1];

/** What a task's `Resource` names, before its parameters are asked. */
const integrationOf = (resource: Reading): IntegrationCall | undefined => {
  if (!resource.read) return undefined;
  const match = INTEGRATION.exec(resource.value.trim());
  if (match === null) return undefined;
  return {
    service: match[2] as string,
    action: match[3] as string,
    pattern: PATTERN_OF_SUFFIX[match[4] ?? ''] ?? 'request-response',
    sdk: match[1] !== undefined,
  };
};

/**
 * What a `Task` state does.
 *
 * `values` fills the `${...}` placeholders a deployment substitutes before the
 * definition reaches the service; without it they stay unread.
 */
export const classifyTask = (state: State, values: TemplateValues = NO_TEMPLATE_VALUES): Task => {
  const resource = readText(state.fields['Resource'], values);
  const call = integrationOf(resource);
  if (call !== undefined) {
    const target = BY_SERVICE.get(call.service)?.classify(call, parametersOf(state, values)) ?? { kind: 'service' };
    return { ...target, call };
  }

  // The resource is not an integration. It may be a function or an activity by
  // its ARN, read the same way as any other name - which is also what lets a
  // placeholder for the account in front of a literal name still be read.
  const text = resource.read ? resource.value : resource.written;
  if (FUNCTION_RESOURCE.test(text)) return { kind: 'function', name: nameIn(resource, functionName) };
  if (ACTIVITY_RESOURCE.test(text)) return { kind: 'activity', name: nameIn(resource, activityName) };
  return { kind: 'unknown', resource };
};
