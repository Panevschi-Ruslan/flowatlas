import { cognitoTriggerKey, DEFAULT_EVENT_BUS, deployedNameIn, eventPatternOf } from '@flowatlas/aws';
import { makeHttpEntryKey, normalizePath, UNREAD_SPAN, type DeliveryKind, type DeliverySource, type DeliveryTarget, type DeployedKind, type PathStep } from '@flowatlas/core';
import { Imported, isRecord, textOf, Unread, userPoolName, type Deployed } from '@flowatlas/serverless';
import type { TemplateReading } from './reading.js';

/**
 * The events a function or a state machine of a SAM template is run by, one
 * reader per `Type` (P246).
 *
 * Each event is written `{ Type, Properties }` under the resource's `Events`,
 * and each reader turns one into what Terraform's reading of the same
 * deployment has: a route on an API, a delivery from a queue, a topic, a bus, a
 * clock, a table's or a stream's changes, a bucket's notifications or a user
 * pool's step, onto the function or workflow that declares it. An event type
 * nothing here reads is said, at `info`, so the map never says nothing runs it.
 */

/** What an event belongs to and where it is written. */
export interface EventSite {
  /** The function or workflow it runs; absent when the workflow's name is not read. */
  readonly to?: DeliveryTarget;
  /** The function, by its position, when it is one: a route needs it. */
  readonly function?: number;
  /** The function's or workflow's name, or its address, for a sentence. */
  readonly label: string;
  /** The logical id of the resource the event is declared on. */
  readonly logicalId: string;
  readonly path: readonly PathStep[];
  /** `Resources.PlaceOrder.Events.Placed`. */
  readonly address: string;
}

type EventReader = (properties: Record<string, unknown>, site: EventSite, reading: TemplateReading) => void;

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const disabled = (properties: Record<string, unknown>): Record<string, unknown> =>
  properties['Enabled'] === false || textOf(properties['State']) === 'DISABLED' ? { disabled: true } : {};

const eventRow = (reading: TemplateReading, site: EventSite, reason: string, message: string, hint: string, level?: 'info'): void =>
  reading.file.row(site.path, site.address, { reason, message, hint, ...(level === undefined ? {} : { level }) });

/** A delivery onto what the event runs, with what the event records about it. */
const deliver = (reading: TemplateReading, site: EventSite, by: DeliveryKind, from: DeliverySource, meta: Record<string, unknown>, name?: string, address = site.address): void => {
  reading.file.parts.deliveries.push({
    ...reading.file.siteOf(site.path),
    address,
    by,
    ...(name === undefined ? {} : { name }),
    from,
    ...(site.to === undefined ? {} : { to: site.to }),
    meta: { declaredAs: address, ...meta, ...reading.conditionOf(site.logicalId) },
  });
};

/** The source a property names, or a row saying why not. */
const sourceNamed = (reading: TemplateReading, value: unknown, site: EventSite, what: string, kind?: DeployedKind): Deployed | undefined => {
  const found = reading.deployedOf(value);
  // Another stack's output, of the kind this event reads (P249).
  if (found instanceof Imported && kind !== undefined) return reading.file.importedAs(found, kind, site.path, what);
  if (found === undefined || found instanceof Unread) {
    eventRow(
      reading,
      site,
      'subscription-source-unread',
      `${what} is not read: ${found === undefined ? (value === undefined ? 'it is not written' : 'it is not an ARN, a Ref or an Fn::GetAtt of anything the template declares') : found.text}`,
      'Write it as a Ref or Fn::GetAtt of a resource the template declares, or as its ARN; a value from another stack or the account is not read.',
    );
    return undefined;
  }
  reading.file.generatedRow(found, site.path);
  return found;
};

/** The filters a mapping is written with, recorded and not matched on. */
const filtersOf = (properties: Record<string, unknown>): Record<string, unknown> => {
  const criteria = isRecord(properties['FilterCriteria']) ? properties['FilterCriteria']['Filters'] : undefined;
  const patterns = asList(criteria).flatMap((filter) => {
    const pattern = isRecord(filter) ? filter['Pattern'] : undefined;
    return pattern === undefined ? [] : [typeof pattern === 'string' ? pattern : JSON.stringify(pattern)];
  });
  return patterns.length === 0 ? {} : { unmatched: { filter: patterns } };
};

// ------------------------------------------------------------------ routes

/** An API of the template by what an event points at, or the one the transform makes when it points at none. */
export interface ApiOf {
  /** Its name, when read. */
  readonly name?: string;
  /** Where it is declared, for keying a route when the name is not read. */
  readonly address: string;
  readonly stage?: string;
  /** The authoriser every route of it stands behind unless the route says otherwise. */
  readonly defaultAuthorizer?: string;
  /** Every route of it asks for an API key unless the route says otherwise. */
  readonly apiKeyRequired?: boolean;
}

export type ApiLookup = (kind: 'rest' | 'http', reference: unknown, site: EventSite) => ApiOf | undefined;

const guardsOf = (reading: TemplateReading, site: EventSite, properties: Record<string, unknown>, api: ApiOf) => {
  const at = reading.file.siteOf(site.path);
  const auth = isRecord(properties['Auth']) ? properties['Auth'] : {};
  const written = textOf(auth['Authorizer']) ?? api.defaultAuthorizer;
  const guards: { label: string; file: string; line: number }[] = [];
  if (written !== undefined && written !== 'NONE') guards.push({ label: written, ...at });
  if (auth['ApiKeyRequired'] === true || (auth['ApiKeyRequired'] === undefined && api.apiKeyRequired === true)) guards.push({ label: 'api key', ...at });
  return guards;
};

/** A route onto the function, keyed as Terraform keys one (P21). */
export const pushRoute = (reading: TemplateReading, site: EventSite, method: string, rawPath: string, api: ApiOf, guards: readonly { label: string; file: string; line: number }[]): void => {
  if (site.function === undefined) return;
  const verb = method.toUpperCase() === 'ANY' || method === '*' || method === 'x-amazon-apigateway-any-method' ? 'ALL' : method.toUpperCase();
  const path = normalizePath(`/${rawPath.replace(/^\/+/, '')}`);
  reading.file.parts.routes.push({
    ...reading.file.siteOf(site.path),
    method: verb,
    path,
    rawPath,
    ...(api.name === undefined ? {} : { api: api.name }),
    target: { function: site.function },
    ...(guards.length === 0 ? {} : { guards }),
    meta: {
      declaredAs: site.address,
      key: makeHttpEntryKey(verb, path),
      apiAddress: api.address,
      ...(api.stage === undefined ? {} : { stage: api.stage }),
      ...reading.conditionOf(site.logicalId),
    },
  });
};

/**
 * A route onto the function that hangs from a point of an API another stack
 * creates and exports (P249): its path is the part below that point, behind an
 * unread span the linker fills with the point's own path.
 */
export const pushRootedRoute = (reading: TemplateReading, site: EventSite, method: string, root: string, rawBelow: string, guards: readonly { label: string; file: string; line: number }[]): void => {
  if (site.function === undefined) return;
  const verb = method.toUpperCase() === 'ANY' || method === '*' ? 'ALL' : method.toUpperCase();
  const below = normalizePath(`/${rawBelow.replace(/^\/+/, '')}`);
  const path = normalizePath(`${UNREAD_SPAN}${below}`);
  reading.file.parts.routes.push({
    ...reading.file.siteOf(site.path),
    method: verb,
    path,
    rawPath: rawBelow,
    target: { function: site.function },
    root: { key: root, below },
    ...(guards.length === 0 ? {} : { guards }),
    meta: { declaredAs: site.address, key: makeHttpEntryKey(verb, path), apiAddress: `import:${root}`, ...reading.conditionOf(site.logicalId) },
  });
};

const routeReader =
  (kind: 'rest' | 'http', apis: ApiLookup): EventReader =>
  (properties, site, reading) => {
    if (site.function === undefined) {
      eventRow(reading, site, 'route-target-unread', `${site.address} is a route that starts the workflow, and a route onto a workflow is not drawn`, 'The workflow is still drawn and joined by its name; this way of starting it is not.');
      return;
    }
    const api = apis(kind, properties[kind === 'rest' ? 'RestApiId' : 'ApiId'], site);
    if (api === undefined) return;
    const method = textOf(properties['Method']);
    const path = textOf(properties['Path']);
    // An HTTP API event with neither is the API's default route, which takes every request.
    if (kind === 'http' && properties['Method'] === undefined && properties['Path'] === undefined) {
      pushRoute(reading, site, 'ANY', '/{proxy+}', api, guardsOf(reading, site, properties, api));
      return;
    }
    if (method === undefined || path === undefined) {
      eventRow(reading, site, 'route-path-unread', `the ${method === undefined ? 'method' : 'path'} of ${site.address} is not read`, 'Write the Method and the Path so the template settles them.');
      return;
    }
    pushRoute(reading, site, method, path, api, guardsOf(reading, site, properties, api));
  };

// ---------------------------------------------------------------- channels

const readSqs: EventReader = (properties, site, reading) => {
  const found = sourceNamed(reading, properties['Queue'], site, `the queue ${site.address} reads`, 'queue');
  if (found === undefined) return;
  if (found.kind !== 'queue') {
    eventRow(reading, site, 'subscription-source-unread', `${site.address} reads ${found.name}, which is a ${found.kind}, not a queue`, 'An SQS event reads a queue.', 'info');
    return;
  }
  deliver(reading, site, 'mapping', { kind: 'queue', name: found.name }, { ...disabled(properties), ...filtersOf(properties) });
};

const readSns: EventReader = (properties, site, reading) => {
  const written = properties['Topic'];
  const text = textOf(written);
  const found = text !== undefined && deployedNameIn(text) === undefined ? ({ kind: 'topic', name: text } as const) : sourceNamed(reading, written, site, `the topic ${site.address} subscribes to`, 'topic');
  if (found === undefined) return;
  if (found.kind !== 'topic') {
    eventRow(reading, site, 'subscription-source-unread', `${site.address} subscribes to ${found.name}, which is a ${found.kind}, not a topic`, 'An SNS event subscribes to a topic.', 'info');
    return;
  }
  const policy = properties['FilterPolicy'];
  deliver(reading, site, 'subscription', { kind: 'topic', name: found.name }, {
    protocol: 'lambda',
    ...(policy === undefined ? {} : { unmatched: { filter_policy: JSON.stringify(policy) } }),
    // The transform puts a queue of its own between the topic and the function.
    ...(properties['SqsSubscription'] === undefined || properties['SqsSubscription'] === false ? {} : { queued: true }),
  });
};

/** A table's stream or a Kinesis stream, read in order; a batch it gives up on goes to its failure destination (P54). */
const streamReader =
  (of: 'table' | 'stream'): EventReader =>
  (properties, site, reading) => {
    const found = sourceNamed(reading, properties['Stream'], site, `the stream ${site.address} reads`, of);
    if (found === undefined) return;
    if (found.kind !== of) {
      eventRow(reading, site, 'subscription-source-unread', `${site.address} reads ${found.name}, which is a ${found.kind}, not a ${of === 'table' ? "table's stream" : 'stream'}`, 'Point Stream at the StreamArn of a table, or the Arn of a stream.', 'info');
      return;
    }
    deliver(reading, site, 'mapping', { kind: 'changes', of, name: found.name }, { ...disabled(properties), ...filtersOf(properties) });
    const failure = isRecord(properties['DestinationConfig']) ? properties['DestinationConfig']['OnFailure'] : undefined;
    if (!isRecord(failure)) return;
    const address = `${site.address}.DestinationConfig.OnFailure`;
    const path = [...site.path, 'Properties', 'DestinationConfig', 'OnFailure'];
    // A mapping hands what it gives up on to a queue or a topic, which an import's use does not tell apart (P253).
    reading.file.deliverTo(
      { ...reading.file.siteOf(path), address, by: 'destination', from: { kind: 'outcome', when: 'failure', of: { delivery: site.address } }, meta: { when: 'failure', ...reading.conditionOf(site.logicalId) } },
      reading.deployedOf(failure['Destination']),
      path,
      `where ${site.address} hands the batches it gives up on`,
      ['queue', 'topic'],
    );
  };

const readS3: EventReader = (properties, site, reading) => {
  const found = reading.deployedOf(properties['Bucket']);
  if (found === undefined || found instanceof Unread || found.kind !== 'bucket') {
    eventRow(
      reading,
      site,
      'bucket-notification-unread',
      `the bucket ${site.address} is notified of is not read${found instanceof Unread ? `: ${found.text}` : ''}`,
      'An S3 event names a bucket the same template declares, by a Ref.',
    );
    return;
  }
  reading.file.generatedRow(found, site.path);
  const filter = isRecord(properties['Filter']) && isRecord(properties['Filter']['S3Key']) ? properties['Filter']['S3Key']['Rules'] : undefined;
  const rules = asList(filter).filter(isRecord);
  const ruleOf = (name: string) => textOf(rules.find((rule) => textOf(rule['Name'])?.toLowerCase() === name)?.['Value']);
  const prefix = ruleOf('prefix');
  const suffix = ruleOf('suffix');
  const events = asList(properties['Events']).map(textOf).filter((event): event is string => event !== undefined);
  deliver(reading, site, 'notification', {
    kind: 'bucket',
    name: found.name,
    events: events.length === 0 ? ['s3:ObjectCreated:*'] : events,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  }, {});
};

/** The bus a property names: a name, an ARN, a Ref of a bus the template declares; the default bus where none is. */
const busOf = (reading: TemplateReading, value: unknown, site: EventSite): string | undefined => {
  if (value === undefined || value === null) return DEFAULT_EVENT_BUS;
  const text = textOf(value);
  if (text !== undefined) return deployedNameIn(text)?.name ?? text;
  const found = sourceNamed(reading, value, site, `the bus ${site.address} takes events from`, 'bus');
  return found?.kind === 'bus' ? found.name : undefined;
};

const transformed = (properties: Record<string, unknown>): Record<string, unknown> =>
  ['Input', 'InputPath', 'InputTransformer'].some((key) => properties[key] !== undefined) ? { transformed: true } : {};

/**
 * Where the events that start something come from, for the types a function
 * and a state machine share: a clock, the scheduler, a rule on a bus.
 */
export const CLOCKS_AND_RULES: ReadonlyMap<string, EventReader> = new Map<string, EventReader>([
  [
    'Schedule',
    (properties, site, reading) =>
      deliver(reading, site, 'schedule', { kind: 'schedule', ...(textOf(properties['Schedule']) === undefined ? {} : { expression: textOf(properties['Schedule']) as string }) }, { ...disabled(properties), ...transformed(properties) }, textOf(properties['Name'])),
  ],
  [
    'ScheduleV2',
    (properties, site, reading) =>
      deliver(reading, site, 'schedule', { kind: 'schedule', ...(textOf(properties['ScheduleExpression']) === undefined ? {} : { expression: textOf(properties['ScheduleExpression']) as string }) }, { ...disabled(properties), ...transformed(properties), scheduler: true }, textOf(properties['Name'])),
  ],
  ['EventBridgeRule', (properties, site, reading) => readRule(properties, site, reading, textOf(properties['RuleName']))],
  ['CloudWatchEvent', (properties, site, reading) => readRule(properties, site, reading, undefined)],
]);

function readRule(properties: Record<string, unknown>, site: EventSite, reading: TemplateReading, name: string | undefined): void {
  const bus = busOf(reading, properties['EventBusName'], site);
  if (bus === undefined) return;
  const pattern = eventPatternOf(properties['Pattern']);
  if ('reason' in pattern) {
    eventRow(reading, site, 'event-pattern-unread', `the pattern of ${site.address} is not read: ${pattern.text}`, 'Write the Pattern as a mapping of fields to lists of values.');
    return;
  }
  deliver(reading, site, 'rule', { kind: 'bus', name: bus, pattern }, { ...disabled(properties), ...transformed(properties) }, name);
}

/** `Cognito: { UserPool, Trigger }`: steps of signing up or in, spelled as Terraform spells them. */
const readCognito: EventReader = (properties, site, reading) => {
  const pool = reading.template.resources.get(textOf(isRecord(properties['UserPool']) ? properties['UserPool']['Ref'] : undefined) ?? '');
  const triggers = asList(properties['Trigger']).map(textOf).filter((trigger): trigger is string => trigger !== undefined);
  if (pool === undefined || pool.type !== 'AWS::Cognito::UserPool' || triggers.length === 0) {
    eventRow(reading, site, 'subscription-source-unread', `the ${pool === undefined ? 'user pool' : 'trigger'} of ${site.address} is not read`, 'A Cognito event names a user pool the same template declares, by a Ref, and its Trigger.');
    return;
  }
  const name = userPoolName(reading.file, pool);
  triggers.forEach((trigger, index) => {
    const key = cognitoTriggerKey(name, trigger);
    const step = key.slice(key.lastIndexOf('/') + 1);
    deliver(reading, site, 'trigger', { kind: 'trigger', service: 'cognito', key }, { pool: name, trigger: step }, step, triggers.length === 1 ? site.address : `${site.address}.Trigger[${index}]`);
  });
};

/** The topic filter of a rule's statement: `SELECT * FROM 'shop/doors/+'`. */
const TOPIC_FILTER = /\bFROM\s+'([^']+)'/i;

/** `IoTRule: { Sql }`: messages on the topics a statement selects, as Terraform keys an IoT rule (P53). */
const readIotRule: EventReader = (properties, site, reading) => {
  const sql = textOf(properties['Sql']);
  const filter = sql === undefined ? undefined : TOPIC_FILTER.exec(sql)?.[1];
  if (filter === undefined) {
    eventRow(reading, site, 'subscription-source-unread', `the topics ${site.address} takes messages from are not read`, "Write the Sql so the template settles it, selecting FROM a topic filter in quotes.");
    return;
  }
  deliver(reading, site, 'rule', { kind: 'trigger', service: 'iot', key: `iot/${filter}` }, {});
};

/** Every event type read, by its `Type`, for a function. */
export const functionEventReaders = (apis: ApiLookup): ReadonlyMap<string, EventReader> =>
  new Map<string, EventReader>([
    ['Api', routeReader('rest', apis)],
    ['HttpApi', routeReader('http', apis)],
    ['SQS', readSqs],
    ['SNS', readSns],
    ['DynamoDB', streamReader('table')],
    ['Kinesis', streamReader('stream')],
    ['S3', readS3],
    ['Cognito', readCognito],
    ['IoTRule', readIotRule],
    ...CLOCKS_AND_RULES,
  ]);

/** Every event type read, by its `Type`, for a state machine: the clocks and rules, and routes, which are said. */
export const workflowEventReaders = (apis: ApiLookup): ReadonlyMap<string, EventReader> =>
  new Map<string, EventReader>([['Api', routeReader('rest', apis)], ['HttpApi', routeReader('http', apis)], ...CLOCKS_AND_RULES]);

/** The `Events` of a resource, each through the reader for its type or said to be unread. */
export const readEvents = (reading: TemplateReading, events: unknown, readers: ReadonlyMap<string, EventReader>, site: Omit<EventSite, 'path' | 'address'> & { readonly path: readonly PathStep[]; readonly address: string }): void => {
  if (!isRecord(events)) return;
  for (const [name, event] of Object.entries(events)) {
    if (!isRecord(event)) continue;
    const type = textOf(event['Type']);
    const at: EventSite = { ...site, path: [...site.path, 'Events', name], address: `${site.address}.Events.${name}` };
    const read = type === undefined ? undefined : readers.get(type);
    if (read !== undefined) {
      read(isRecord(event['Properties']) ? event['Properties'] : {}, at, reading);
      continue;
    }
    eventRow(
      reading,
      at,
      'invoker-not-read',
      `${site.label} is run by ${type ?? 'an event with no Type'} events, which are not read, so nothing drawn reaches it that way`,
      'Events of this kind run it outside anything this reads. Nothing to fix; it is still in the graph under its name.',
      'info',
    );
  }
};
