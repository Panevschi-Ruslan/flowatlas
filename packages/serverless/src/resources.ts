import { cognitoTriggerKey, DEFAULT_EVENT_BUS, deployedNameIn, destinationOf, eventPatternOf, READ_PRINCIPALS } from '@flowatlas/aws';
import { generatedName, makeFunctionUrlEntryKey, type DeployedKind, type DeliverySource, type PathStep } from '@flowatlas/core';
import { intrinsicOf, type Deployed, type Resource } from './cloudformation.js';
import type { FileReading } from './reading.js';
import { Imported, isRecord, textOf, Unread } from './variables.js';

/**
 * What the resources of a template declare besides themselves (P57): a
 * table's stream, a queue's redrive, a topic's subscriptions, a rule's
 * targets, a mapping, a bucket's notifications. Each is the delivery or the
 * stream Terraform's reading of the same resource gives, in the same shape, so
 * the adapter draws one as it draws the other.
 *
 * One reader per resource type, in a table (Strategy); a type nothing here
 * reads is skipped, because most of a template is roles and policies.
 */

type ResourceReader = (resource: Resource, reading: FileReading) => void;

const pathOf = (resource: Resource): readonly PathStep[] => resource.path;

/** The deployed thing a resource itself declares. */
const own = (resource: Resource, reading: FileReading): Deployed | Unread | undefined => reading.template.named(resource.logicalId);

/** A row about a resource, at the resource. */
const resourceRow = (reading: FileReading, resource: Resource, reason: string, message: string, hint: string, level?: 'info'): void =>
  reading.row(pathOf(resource), resource.address, { reason, message, hint, ...(level === undefined ? {} : { level }) });

/** A resource whose name the platform generates says so once, wherever it is first met. */
const declared = (resource: Resource, reading: FileReading): Deployed | undefined => {
  const found = own(resource, reading);
  if (found === undefined || found instanceof Unread) return undefined;
  reading.generatedRow(found, pathOf(resource));
  return found;
};

/**
 * A delivery from a resource onto what a value names. A value another
 * deployment publishes is read as each kind of thing the delivery can hand
 * to - `kinds`, one where the use says which (a subscription's protocol), more
 * where it does not (a rule's target) - and the linker keeps the one the
 * publisher's value is (P253, P259).
 */
const pushDelivery = (
  reading: FileReading,
  resource: Resource,
  address: string,
  by: Parameters<FileReading['parts']['deliveries']['push']>[0]['by'],
  from: DeliverySource,
  target: unknown,
  what: string,
  kinds: readonly DeployedKind[],
  meta: Record<string, unknown> = {},
  name?: string,
): void => {
  reading.deliverTo(
    {
      ...reading.siteOf(pathOf(resource)),
      address,
      by,
      ...(name === undefined ? {} : { name }),
      from,
      ...(Object.keys(meta).length === 0 ? {} : { meta }),
    },
    reading.template.deployedOf(target),
    pathOf(resource),
    what,
    kinds,
  );
};

/** What a rule's or a schedule's target may be, where the use does not say (P259): everything a delivery hands to. */
export const TARGET_KINDS: readonly DeployedKind[] = ['function', 'queue', 'topic', 'bus', 'workflow'];

/** What a subscription delivers to by its protocol. */
const SUBSCRIBED: ReadonlyMap<string, DeployedKind> = new Map([
  ['lambda', 'function'],
  ['sqs', 'queue'],
]);

/** A table with a stream, and a Kinesis stream: what a write in code publishes onto (P51). */
const readTable: ResourceReader = (resource, reading) => {
  const found = declared(resource, reading);
  const specification = resource.properties['StreamSpecification'];
  const hasStream = isRecord(specification) && textOf(specification['StreamViewType']) !== undefined;
  if (found === undefined || !hasStream) return;
  reading.parts.streams.push({ ...reading.siteOf(pathOf(resource)), address: resource.address, of: 'table', name: found.name });
};

const readKinesis: ResourceReader = (resource, reading) => {
  const found = declared(resource, reading);
  if (found === undefined) return;
  reading.parts.streams.push({ ...reading.siteOf(pathOf(resource)), address: resource.address, of: 'stream', name: found.name });
};

/** A queue: its name, and the dead-letter queue its redrive policy hands failures to. */
const readQueue: ResourceReader = (resource, reading) => {
  const found = declared(resource, reading);
  const policy = resource.properties['RedrivePolicy'];
  if (!isRecord(policy) || found === undefined) return;
  const receives = policy['maxReceiveCount'];
  pushDelivery(
    reading,
    resource,
    resource.address,
    'redrive',
    { kind: 'queue', name: found.name },
    policy['deadLetterTargetArn'],
    `the dead-letter queue of ${resource.address}`,
    ['queue'],
    typeof receives === 'number' ? { maxReceiveCount: receives } : {},
  );
};

const subscription = (reading: FileReading, resource: Resource, address: string, topic: string, protocol: string | undefined, endpoint: unknown, policy: unknown): void => {
  const meta = {
    ...(protocol === undefined ? {} : { protocol }),
    ...(policy === undefined ? {} : { unmatched: { filter_policy: JSON.stringify(policy) } }),
  };
  const kind = protocol === undefined ? undefined : SUBSCRIBED.get(protocol);
  if (kind === undefined) {
    resourceRow(reading, resource, 'subscription-target-unread', `${address} delivers by ${protocol ?? 'a protocol not read'}, which nothing here follows`, 'An e-mail, an HTTP endpoint or a phone is outside the map. Nothing to fix.', 'info');
    reading.parts.deliveries.push({ ...reading.siteOf(pathOf(resource)), address, by: 'subscription', from: { kind: 'topic', name: topic }, meta });
    return;
  }
  pushDelivery(reading, resource, address, 'subscription', { kind: 'topic', name: topic }, endpoint, `what ${address} delivers to`, [kind], meta);
};

/** A topic, and the subscriptions written inside it. */
const readTopic: ResourceReader = (resource, reading) => {
  const found = declared(resource, reading);
  const inline = resource.properties['Subscription'];
  if (found === undefined || !Array.isArray(inline)) return;
  inline.forEach((item, index) => {
    if (!isRecord(item)) return;
    subscription(reading, resource, `${resource.address}.Subscription[${index}]`, found.name, textOf(item['Protocol']), item['Endpoint'], undefined);
  });
};

const readSubscription: ResourceReader = (resource, reading) => {
  const topic = reading.template.deployedOf(resource.properties['TopicArn']);
  if (topic === undefined || topic instanceof Unread || topic.kind !== 'topic') {
    resourceRow(reading, resource, 'subscription-source-unread', `the topic ${resource.address} subscribes to is not read${topic instanceof Unread ? `: ${topic.text}` : ''}`, 'Write TopicArn as a Ref of a topic the file declares, or its ARN.');
    return;
  }
  subscription(reading, resource, resource.address, topic.name, textOf(resource.properties['Protocol']), resource.properties['Endpoint'], resource.properties['FilterPolicy']);
};

/** A rule: a pattern on a bus or a schedule, and a delivery per target. */
const readRule: ResourceReader = (resource, reading) => {
  const { properties } = resource;
  const name = textOf(properties['Name']);
  const schedule = textOf(properties['ScheduleExpression']);
  let from: DeliverySource;
  if (schedule !== undefined) {
    from = { kind: 'schedule', expression: schedule };
  } else {
    const written = properties['EventBusName'];
    const text = textOf(written);
    const found = text === undefined && written !== undefined ? reading.template.deployedOf(written) : undefined;
    const bus = written === undefined ? DEFAULT_EVENT_BUS : (text !== undefined ? (deployedNameIn(text)?.name ?? text) : found !== undefined && !(found instanceof Unread) ? found.name : undefined);
    if (bus === undefined) {
      resourceRow(reading, resource, 'subscription-source-unread', `the bus ${resource.address} takes events from is not read`, 'Write EventBusName as the bus name, or a Ref of a bus the file declares.');
      return;
    }
    const pattern = eventPatternOf(properties['EventPattern']);
    if ('reason' in pattern) {
      resourceRow(reading, resource, 'event-pattern-unread', `the EventPattern of ${resource.address} is not read: ${pattern.text}`, 'Write the pattern as a mapping of fields to lists of values.');
      return;
    }
    from = { kind: 'bus', name: bus, pattern };
  }
  const targets = Array.isArray(properties['Targets']) ? properties['Targets'] : [];
  targets.forEach((target, index) => {
    if (!isRecord(target)) return;
    const transformed = ['Input', 'InputPath', 'InputTransformer'].some((key) => target[key] !== undefined);
    pushDelivery(
      reading,
      resource,
      `${resource.address}.Targets[${index}]`,
      from.kind === 'schedule' ? 'schedule' : 'rule',
      from,
      target['Arn'],
      `the target of ${resource.address}`,
      TARGET_KINDS,
      { rule: resource.address, ...(textOf(properties['State']) === 'DISABLED' ? { disabled: true } : {}), ...(transformed ? { transformed: true } : {}) },
      name,
    );
  });
};

/**
 * What a mapping reads where it reads a value another deployment publishes
 * (P253): a queue, where it takes no starting position, which only a stream
 * and a table's changes take - and which of those two only the publisher
 * says, so it is read as both and the linker keeps one.
 */
export const mappedKinds = (startingPosition: unknown): readonly DeployedKind[] => (startingPosition === undefined ? ['queue'] : ['stream', 'table']);

/** A source a mapping reads from, by the kind of thing it is. */
export const mappedSource = (kind: DeployedKind, name: string): DeliverySource | undefined =>
  kind === 'queue' ? { kind: 'queue', name } : kind === 'stream' || kind === 'table' ? { kind: 'changes', of: kind, name } : undefined;

/** Where a destination may hand a run on to, where the use does not say (P253). */
export const DESTINATION_KINDS: readonly DeployedKind[] = ['queue', 'topic', 'bus', 'function'];

/** A mapping from a queue or a stream to a function, written as a resource of its own. */
const readMapping: ResourceReader = (resource, reading) => {
  const source = reading.template.deployedOf(resource.properties['EventSourceArn']);
  if (source instanceof Imported) {
    const what = `what ${resource.address} reads`;
    const to = reading.targetOf(functionIn(reading, resource.properties['FunctionName']), pathOf(resource), resource.address, `the function ${resource.address} hands its batches to`);
    for (const alternative of reading.alternativesOf(source, mappedKinds(resource.properties['StartingPosition']), pathOf(resource), what, resource.address)) {
      const from = mappedSource(alternative.kind, alternative.name);
      if (from === undefined) continue;
      reading.parts.deliveries.push({
        ...reading.siteOf(pathOf(resource)),
        address: alternative.address,
        by: 'mapping',
        from,
        ...(to === undefined ? {} : { to }),
        ...(resource.properties['Enabled'] === false ? { meta: { disabled: true } } : {}),
      });
    }
    return;
  }
  if (source === undefined || source instanceof Unread) {
    resourceRow(reading, resource, 'subscription-source-unread', `what ${resource.address} reads is not read${source instanceof Unread ? `: ${source.text}` : ''}`, 'Write EventSourceArn as an Fn::GetAtt of a queue or a stream the file declares, or its ARN.');
    return;
  }
  const from: DeliverySource | undefined =
    source.kind === 'queue'
      ? { kind: 'queue', name: source.name }
      : source.kind === 'stream' || (source.kind === 'table' && source.changes === true)
        ? { kind: 'changes', of: source.kind === 'stream' ? 'stream' : 'table', name: source.name }
        : undefined;
  if (from === undefined) {
    resourceRow(reading, resource, 'subscription-source-unread', `${resource.address} reads ${source.name}, which is not read from in order`, 'A mapping reads a queue or a stream.', 'info');
    return;
  }
  const fn = resource.properties['FunctionName'];
  const text = textOf(fn);
  const target = text !== undefined && deployedNameIn(text) === undefined ? { kind: 'function' as const, name: text } : reading.template.deployedOf(fn);
  const to = reading.targetOf(target, pathOf(resource), resource.address, `the function ${resource.address} hands its batches to`);
  reading.parts.deliveries.push({
    ...reading.siteOf(pathOf(resource)),
    address: resource.address,
    by: 'mapping',
    from,
    ...(to === undefined ? {} : { to }),
    ...(resource.properties['Enabled'] === false ? { meta: { disabled: true } } : {}),
  });
};

/** The configurations of a bucket's notification, the property naming each target, and what it is. */
const NOTIFICATIONS: ReadonlyArray<readonly [list: string, target: string, kind: DeployedKind]> = [
  ['LambdaConfigurations', 'Function', 'function'],
  ['QueueConfigurations', 'Queue', 'queue'],
  ['TopicConfigurations', 'Topic', 'topic'],
];

const readBucket: ResourceReader = (resource, reading) => {
  const found = declared(resource, reading);
  const configuration = resource.properties['NotificationConfiguration'];
  if (found === undefined || !isRecord(configuration)) return;
  for (const [list, property, kind] of NOTIFICATIONS) {
    const items = Array.isArray(configuration[list]) ? (configuration[list] as unknown[]) : [];
    items.forEach((item, index) => {
      if (!isRecord(item)) return;
      const event = textOf(item['Event']);
      const filter = isRecord(item['Filter']) && isRecord(item['Filter']['S3Key']) ? item['Filter']['S3Key']['Rules'] : undefined;
      const rules = Array.isArray(filter) ? filter.filter(isRecord) : [];
      const ruleOf = (name: string) => textOf(rules.find((rule) => textOf(rule['Name'])?.toLowerCase() === name)?.['Value']);
      const prefix = ruleOf('prefix');
      const suffix = ruleOf('suffix');
      if (event === undefined) {
        resourceRow(reading, resource, 'bucket-notification-unread', `the event of ${resource.address}.${list}[${index}] is not read`, 'Write the Event so the file settles it.');
        return;
      }
      pushDelivery(
        reading,
        resource,
        `${resource.address}.${list}[${index}]`,
        'notification',
        { kind: 'bucket', name: found.name, events: [event], ...(prefix === undefined ? {} : { prefix }), ...(suffix === undefined ? {} : { suffix }) },
        item[property],
        `what ${resource.address}.${list}[${index}] notifies`,
        [kind],
      );
    });
  }
};

/** A function a property names: one of this template's by reference, or any by its name or ARN. */
const functionIn = (reading: FileReading, value: unknown): Deployed | Unread | undefined => {
  const text = textOf(value);
  return text !== undefined && deployedNameIn(text) === undefined ? { kind: 'function', name: text } : reading.template.deployedOf(value);
};

/** A schedule of the scheduler (P246): a clock, and the one target it runs. */
const readSchedule: ResourceReader = (resource, reading) => {
  const { properties } = resource;
  const expression = textOf(properties['ScheduleExpression']);
  const target = isRecord(properties['Target']) ? properties['Target'] : {};
  pushDelivery(
    reading,
    resource,
    resource.address,
    'schedule',
    { kind: 'schedule', ...(expression === undefined ? {} : { expression }) },
    target['Arn'],
    `the target of ${resource.address}`,
    TARGET_KINDS,
    {
      ...(textOf(properties['State']) === 'DISABLED' ? { disabled: true } : {}),
      ...(target['Input'] === undefined ? {} : { transformed: true }),
    },
    textOf(properties['Name']),
  );
};

/** Where a function's runs are handed on, written as a resource of its own (P246). */
const readInvokeConfig: ResourceReader = (resource, reading) => {
  const fn = functionIn(reading, resource.properties['FunctionName']);
  if (fn === undefined || fn instanceof Unread || fn.kind !== 'function') {
    resourceRow(reading, resource, 'subscription-source-unread', `the function ${resource.address} configures is not read${fn instanceof Unread ? `: ${fn.text}` : ''}`, 'Write FunctionName as a Ref of a function the template declares, or its name.');
    return;
  }
  const config = isRecord(resource.properties['DestinationConfig']) ? resource.properties['DestinationConfig'] : {};
  for (const [key, when] of [
    ['OnSuccess', 'success'],
    ['OnFailure', 'failure'],
  ] as const) {
    const written = config[key];
    if (!isRecord(written)) continue;
    const address = `${resource.address}.DestinationConfig.${key}`;
    reading.deliverTo(
      {
        ...reading.siteOf(pathOf(resource)),
        address,
        by: 'destination',
        from: { kind: 'outcome', when, of: fn.function === undefined ? { name: fn.name } : { function: fn.function } },
        meta: { when },
      },
      reading.template.deployedOf(written['Destination']),
      pathOf(resource),
      `the ${when} destination of ${resource.address}`,
      DESTINATION_KINDS,
      (to) => destinationOf(to, when),
    );
  }
};

/** The steps of signing up and in a user pool runs a function at (P246), spelled as Terraform spells them. */
const readUserPool: ResourceReader = (resource, reading) => {
  const config = resource.properties['LambdaConfig'];
  if (!isRecord(config)) return;
  const pool = userPoolName(reading, resource);
  for (const [trigger, written] of Object.entries(config)) {
    if (trigger === 'KMSKeyID') continue;
    // The senders and the newer token step are written with the version beside the function.
    const target = isRecord(written) && intrinsicOf(written) === undefined ? written['LambdaArn'] : written;
    const key = cognitoTriggerKey(pool, trigger.replace(/Config$/, ''));
    const step = key.slice(key.lastIndexOf('/') + 1);
    pushDelivery(reading, resource, `${resource.address}.LambdaConfig.${trigger}`, 'trigger', { kind: 'trigger', service: 'cognito', key }, target, `the function ${resource.address} runs at ${trigger}`, ['function'], { pool, trigger: step }, step);
  }
};

/** A user pool's name, or where it is declared when the platform names it. */
export const userPoolName = (reading: FileReading, resource: Resource): string => {
  const written = textOf(resource.properties['UserPoolName']);
  if (written !== undefined) return written;
  if (resource.properties['UserPoolName'] === undefined) {
    resourceRow(
      reading,
      resource,
      'deployed-name-generated',
      `${resource.address} is a user pool with no name of its own, so its triggers are named by where it is declared`,
      'Give it a UserPoolName where other repositories name its triggers.',
      'info',
    );
  }
  return generatedName(resource.address);
};

/** A function's own address, written as a resource (P246): every verb and every path, keyed as Terraform keys one. */
const readFunctionUrl: ResourceReader = (resource, reading) => {
  const fn = functionIn(reading, resource.properties['TargetFunctionArn']);
  if (fn === undefined || fn instanceof Unread || fn.kind !== 'function') {
    resourceRow(reading, resource, 'route-target-unread', `the function ${resource.address} is the address of is not read${fn instanceof Unread ? `: ${fn.text}` : ''}`, 'Write TargetFunctionArn as a Ref or Fn::GetAtt of a function the template declares.');
    return;
  }
  pushFunctionUrl(reading, resource.path, resource.address, fn, textOf(resource.properties['AuthType']));
};

/**
 * A permission for a principal no reader follows to run a function (P248),
 * said as Terraform's reading says one: a service whose invocations are read
 * from the resources that make them adds nothing, and neither does the
 * permission behind a function URL, whose route the URL itself gives.
 */
const readPermission: ResourceReader = (resource, reading) => {
  const { properties } = resource;
  const principal = textOf(properties['Principal']);
  if (principal === undefined || READ_PRINCIPALS.has(principal)) return;
  if (properties['FunctionUrlAuthType'] !== undefined || textOf(properties['Action']) === 'lambda:InvokeFunctionUrl') return;
  const fn = functionIn(reading, properties['FunctionName']);
  const named = fn !== undefined && !(fn instanceof Unread) && fn.kind === 'function' ? fn.name : undefined;
  reading.row(resource.path, resource.address, {
    reason: 'invoker-not-read',
    level: 'info',
    message: `${named ?? resource.address} may be run by ${principal}, which is not read, so what runs it from there is not drawn`,
    hint: 'The function is still a way in of its own; nothing here says it is unused because nothing drawn reaches it.',
    meta: { principal, ...(named === undefined ? {} : { function: named }) },
  });
};

/** A function URL as a route, by the function it is the address of. */
export const pushFunctionUrl = (reading: FileReading, path: readonly PathStep[], address: string, fn: Deployed, authType: string | undefined): void => {
  const at = reading.siteOf(path);
  reading.parts.routes.push({
    ...at,
    method: 'ALL',
    path: '/*',
    rawPath: '/*',
    target: fn.function === undefined ? { name: fn.name } : { function: fn.function },
    ...(authType === 'AWS_IAM' ? { guards: [{ label: 'AWS_IAM', ...at }] } : {}),
    meta: { declaredAs: address, key: makeFunctionUrlEntryKey(fn.name), by: 'function-url' },
  });
};

export type { ResourceReader };

/** The resource types read, one reader each (Strategy). */
export const RESOURCE_READERS: ReadonlyMap<string, ResourceReader> = new Map<string, ResourceReader>([
  ['AWS::DynamoDB::Table', readTable],
  ['AWS::DynamoDB::GlobalTable', readTable],
  ['AWS::Kinesis::Stream', readKinesis],
  ['AWS::SQS::Queue', readQueue],
  ['AWS::SNS::Topic', readTopic],
  ['AWS::SNS::Subscription', readSubscription],
  ['AWS::Events::Rule', readRule],
  ['AWS::Lambda::EventSourceMapping', readMapping],
  ['AWS::Lambda::EventInvokeConfig', readInvokeConfig],
  ['AWS::Lambda::Url', readFunctionUrl],
  ['AWS::Lambda::Permission', readPermission],
  ['AWS::Scheduler::Schedule', readSchedule],
  ['AWS::Cognito::UserPool', readUserPool],
  ['AWS::S3::Bucket', readBucket],
]);

/**
 * Every resource of a template, through the reader for its type: the
 * caller's own first, where it reads types of its own (a SAM template's).
 */
export const readResources = (reading: FileReading, own: ReadonlyMap<string, ResourceReader> = new Map()): void => {
  for (const resource of reading.template.resources.values()) {
    const read = own.get(resource.type) ?? RESOURCE_READERS.get(resource.type);
    if (read !== undefined) read(resource, reading);
    else if (reading.template.kinds.has(resource.type)) declared(resource, reading);
  }
};

export { intrinsicOf };
