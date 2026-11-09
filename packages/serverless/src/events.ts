import { cognitoTriggerKey, DEFAULT_EVENT_BUS, deployedNameIn, eventPatternOf } from '@flowatlas/aws';
import {
  makeFunctionUrlEntryKey,
  makeHttpEntryKey,
  normalizePath,
  UNREAD_SPAN,
  type DeliverySource,
  type DeployedDelivery,
  type DeployedKind,
  type PathStep,
} from '@flowatlas/core';
import { intrinsicOf, type Deployed } from './cloudformation.js';
import type { FileReading } from './reading.js';
import { Imported, isRecord, textOf, Unread } from './variables.js';

/**
 * The events a function is run by, one reader per event type (P57).
 *
 * Each event is written as a mapping with one key - the type - and its
 * settings, or the type and a short string. Each reader turns one into what
 * Terraform's reading of the same deployment would have: a route, a delivery
 * from a channel, a schedule, a socket route or a trigger, onto the function
 * that declares it. An event type nothing here reads is said, at `info`, so
 * the map never claims nothing runs the function.
 */

/** The function an event belongs to, and where the event is written. */
export interface EventSite {
  /** The function's key in `functions`. */
  readonly key: string;
  /** Its position among the deployment's functions. */
  readonly index: number;
  /** Its deployed name, when read. */
  readonly name?: string;
  /** Where the event is in the file. */
  readonly path: readonly PathStep[];
  /** The event, for a person and for every row about it: `functions.placeOrder.events[0]`. */
  readonly address: string;
}

/**
 * An API another deployment creates and this service hangs its routes from
 * (P249): the key of the point it is published under, or why that is not read.
 */
export type SharedApi = { readonly root: string } | { readonly unread: string };

/** The APIs a service's events hang their routes from, by kind. */
export interface Apis {
  readonly rest?: string;
  readonly http?: string;
  readonly socket?: string;
  /** `provider.apiGateway.restApiId`: the REST API is another deployment's. */
  readonly sharedRest?: SharedApi;
  /** `provider.httpApi.id`: the HTTP API is another deployment's. */
  readonly sharedHttp?: SharedApi;
}

/** What every event reader is handed. */
export interface EventReading {
  readonly file: FileReading;
  readonly apis: Apis;
}

type EventReader = (value: unknown, site: EventSite, reading: EventReading) => void;

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

/**
 * An event's settings: the mapping it is written as, or - where it is written
 * short, as a name, an ARN or an intrinsic function - that value under the
 * setting it stands for.
 */
const settingsOf = (value: unknown, short: string): Record<string, unknown> =>
  isRecord(value) && intrinsicOf(value) === undefined ? value : { [short]: value };

const disabled = (settings: Record<string, unknown>): boolean => settings['enabled'] === false;

/** The function as a delivery's target. */
const toFunction = (site: EventSite) => ({ kind: 'function' as const, function: site.index });

/** A delivery from a source onto the function, with what the event records about it. */
const deliver = (
  reading: EventReading,
  site: EventSite,
  by: DeployedDelivery['by'],
  from: DeliverySource,
  meta: Record<string, unknown>,
  extra: { readonly address?: string; readonly name?: string } = {},
): void => {
  reading.file.parts.deliveries.push({
    ...reading.file.siteOf(site.path),
    address: extra.address ?? site.address,
    by,
    ...(extra.name === undefined ? {} : { name: extra.name }),
    from,
    to: toFunction(site),
    meta: { declaredAs: extra.address ?? site.address, ...meta },
  });
};

/** A row about an event, at the event. */
const eventRow = (reading: EventReading, site: EventSite, reason: string, message: string, hint: string, level?: 'info'): void =>
  reading.file.row(site.path, site.address, { reason, message, hint, ...(level === undefined ? {} : { level }) });

/** The source a value names, of one kind, or why not. */
const sourceNamed = (reading: EventReading, value: unknown, site: EventSite, what: string, kinds: readonly DeployedKind[] = []): Deployed | undefined => {
  const found = reading.file.template.deployedOf(value);
  // Another stack's output, of the kind this event reads (P249).
  const [kind] = kinds;
  if (found instanceof Imported && kind !== undefined) return reading.file.importedAs(found, kind, site.path, what, kinds);
  if (found === undefined || found instanceof Unread) {
    eventRow(
      reading,
      site,
      'subscription-source-unread',
      `${what} is not read: ${found === undefined ? 'it is not an ARN, a Ref or an Fn::GetAtt of anything this file declares' : found.text}`,
      'Write it as the ARN of the resource, or a Ref or Fn::GetAtt of a resource under resources.Resources; a value from another stack or the account is not read.',
    );
    return undefined;
  }
  reading.file.generatedRow(found, site.path);
  return found;
};

// ------------------------------------------------------------------ routes

/** A route's guard: an authoriser by name or kind, an API key, or IAM. */
const guardsOf = (reading: EventReading, site: EventSite, settings: Record<string, unknown>) => {
  const guards: { label: string; file: string; line: number }[] = [];
  const at = reading.file.siteOf(site.path);
  const authorizer = settings['authorizer'];
  const label =
    textOf(authorizer) ??
    (isRecord(authorizer) ? (textOf(authorizer['name']) ?? textOf(authorizer['type']) ?? (authorizer['arn'] === undefined ? undefined : 'authorizer')) : undefined);
  if (label !== undefined) guards.push({ label, ...at });
  if (settings['private'] === true) guards.push({ label: 'api key', ...at });
  return guards;
};

/**
 * A route onto the function, keyed as Terraform keys one (P21). On an API
 * another deployment creates, it hangs from the point that deployment
 * publishes, which the linker gives it its full path from (P249).
 */
const route = (reading: EventReading, site: EventSite, method: string, rawPath: string, api: string | SharedApi, settings: Record<string, unknown>, apiAddress: string): void => {
  const verb = method.toUpperCase() === 'ANY' || method === '*' ? 'ALL' : method.toUpperCase();
  const below = normalizePath(`/${rawPath.replace(/^\/+/, '')}`);
  if (typeof api !== 'string' && 'unread' in api) {
    eventRow(reading, site, 'route-path-unread', `${site.address} hangs from an API another deployment creates, and ${api.unread}`, 'Point restApiId or httpApi.id at an output of the deployment that creates the API - ${cf:<stack>.<output>} or Fn::ImportValue - so the route is joined to it.');
    return;
  }
  const path = typeof api === 'string' ? below : normalizePath(`${UNREAD_SPAN}${below}`);
  const guards = guardsOf(reading, site, settings);
  reading.file.parts.routes.push({
    ...reading.file.siteOf(site.path),
    method: verb,
    path,
    rawPath,
    ...(typeof api === 'string' ? { api } : { root: { key: api.root, below } }),
    target: { function: site.index },
    ...(guards.length === 0 ? {} : { guards }),
    meta: { declaredAs: site.address, key: makeHttpEntryKey(verb, path), apiAddress: typeof api === 'string' ? apiAddress : `import:${api.root}` },
  });
};

/** `http: GET orders/{id}`, or `http: { method, path, authorizer, private }`: a REST API route. */
const readHttp: EventReader = (value, site, reading) => {
  const settings = isRecord(value) ? value : {};
  const short = textOf(value)?.split(/\s+/);
  const method = textOf(settings['method']) ?? short?.[0];
  const path = textOf(settings['path']) ?? short?.[1] ?? (short === undefined ? undefined : '/');
  const api = reading.apis.sharedRest ?? reading.apis.rest;
  if (method === undefined || path === undefined || api === undefined) {
    eventRow(reading, site, 'route-path-unread', `the ${method === undefined ? 'method' : path === undefined ? 'path' : 'API name'} of ${site.address} is not read`, 'Write the method and the path so the file settles them.');
    return;
  }
  route(reading, site, method, path, api, settings, `${reading.file.file}#rest-api`);
};

/** `httpApi: 'GET /orders'`, `httpApi: '*'`, or `httpApi: { method, path, authorizer }`: an HTTP API route. */
const readHttpApi: EventReader = (value, site, reading) => {
  const settings = isRecord(value) ? value : {};
  const text = textOf(value);
  const [shortMethod, shortPath] = text === '*' ? ['*', '/{proxy+}'] : (text?.split(/\s+/) ?? []);
  const method = textOf(settings['method']) ?? shortMethod;
  const rawPath = textOf(settings['path']) ?? shortPath;
  const api = reading.apis.sharedHttp ?? reading.apis.http;
  if (method === undefined || rawPath === undefined || api === undefined) {
    eventRow(reading, site, 'route-path-unread', `the route key of ${site.address} is not read`, 'Write the method and the path so the file settles them, such as "GET /orders".');
    return;
  }
  route(reading, site, method, method === '*' && rawPath === '*' ? '/{proxy+}' : rawPath, api, settings, `${reading.file.file}#http-api`);
};

/** `websocket: $connect`, or `websocket: { route }`: a way in of the socket API. */
const readWebsocket: EventReader = (value, site, reading) => {
  const key = textOf(value) ?? (isRecord(value) ? textOf(value['route']) : undefined);
  if (key === undefined || reading.apis.socket === undefined) {
    eventRow(reading, site, 'route-path-unread', `the route key of ${site.address} is not read`, 'Write the route as a string, such as "$connect".');
    return;
  }
  deliver(reading, site, 'route', { kind: 'connection', api: reading.apis.socket, route: key }, {}, { name: key });
};

// ---------------------------------------------------------------- channels

/** The filters a mapping is written with, recorded and not matched on. */
const filtersOf = (settings: Record<string, unknown>): Record<string, unknown> => {
  const patterns = settings['filterPatterns'];
  return Array.isArray(patterns) && patterns.length > 0 ? { unmatched: { filter: patterns.map((pattern) => JSON.stringify(pattern)) } } : {};
};

/** `sqs: <arn>`, or `sqs: { arn, batchSize, enabled, filterPatterns }`: a mapping from a queue. */
const readSqs: EventReader = (value, site, reading) => {
  const settings = settingsOf(value, 'arn');
  const found = sourceNamed(reading, settings['arn'], site, `the queue ${site.address} reads`, ['queue']);
  if (found === undefined) return;
  if (found.kind !== 'queue') {
    eventRow(reading, site, 'subscription-source-unread', `${site.address} reads ${found.name}, which is a ${found.kind}, not a queue`, 'An sqs event reads a queue.', 'info');
    return;
  }
  deliver(reading, site, 'mapping', { kind: 'queue', name: found.name }, { ...(disabled(settings) ? { disabled: true } : {}), ...filtersOf(settings) });
};

/**
 * `sns: <topic name or arn>`, or `sns: { arn, topicName, filterPolicy }`. A name
 * that is not an ARN is a topic the framework creates under that name.
 */
const readSns: EventReader = (value, site, reading) => {
  const settings = settingsOf(value, 'arn');
  const arn = settings['arn'];
  const named = textOf(arn) ?? textOf(settings['topicName']);
  const fromArn = arn === undefined ? undefined : reading.file.template.deployedOf(arn);
  let topic: string | undefined;
  if (fromArn !== undefined && !(fromArn instanceof Unread) && fromArn.kind === 'topic') {
    reading.file.generatedRow(fromArn, site.path);
    topic = fromArn.name;
  } else if (fromArn instanceof Imported) {
    // Another stack's topic (P249).
    topic = reading.file.importedAs(fromArn, 'topic', site.path, `the topic ${site.address} subscribes to`).name;
  } else if (named !== undefined && deployedNameIn(named) === undefined) {
    topic = named;
  } else if (textOf(settings['topicName']) !== undefined) {
    topic = textOf(settings['topicName']);
  }
  if (topic === undefined) {
    const why = fromArn instanceof Unread ? fromArn.text : 'it is not a topic name, an ARN, or a Ref of a topic this file declares';
    eventRow(reading, site, 'subscription-source-unread', `the topic ${site.address} subscribes to is not read: ${why}`, 'Write the topic name, or the ARN with topicName beside it.');
    return;
  }
  const policy = settings['filterPolicy'];
  deliver(reading, site, 'subscription', { kind: 'topic', name: topic }, {
    protocol: 'lambda',
    ...(policy === undefined ? {} : { unmatched: { filter_policy: JSON.stringify(policy) } }),
  });
};

/** `stream: <arn>`, or `stream: { type, arn, enabled, filterPatterns }`: a table's stream or a Kinesis stream, read in order. */
const readStream: EventReader = (value, site, reading) => {
  const settings = settingsOf(value, 'arn');
  const found = sourceNamed(reading, settings['arn'], site, `the stream ${site.address} reads`, [settings['type'] === 'kinesis' ? 'stream' : 'table']);
  if (found === undefined) return;
  const of = found.kind === 'stream' ? 'stream' : found.kind === 'table' ? 'table' : undefined;
  if (of === undefined) {
    eventRow(reading, site, 'subscription-source-unread', `${site.address} reads ${found.name}, which is a ${found.kind}, not a stream`, 'A stream event reads a table\'s stream or a Kinesis stream.', 'info');
    return;
  }
  deliver(reading, site, 'mapping', { kind: 'changes', of, name: found.name }, { ...(disabled(settings) ? { disabled: true } : {}), ...filtersOf(settings) });
  // A batch it gives up on goes to `destinations.onFailure`: an ARN, or `{ arn, type }` saying which of a queue or a topic it is (P264).
  const failure = isRecord(settings['destinations']) ? settings['destinations']['onFailure'] : undefined;
  if (failure === undefined) return;
  const target = isRecord(failure) && intrinsicOf(failure) === undefined ? failure['arn'] : failure;
  const typed = isRecord(failure) ? STREAM_FAILURE_TYPES.get(textOf(failure['type']) ?? '') : undefined;
  const path = [...site.path, 'stream', 'destinations', 'onFailure'];
  reading.file.deliverTo(
    { ...reading.file.siteOf(path), address: `${site.address}.destinations.onFailure`, by: 'destination', from: { kind: 'outcome', when: 'failure', of: { delivery: site.address } }, meta: { when: 'failure' } },
    reading.file.template.deployedOf(target),
    path,
    `where ${site.address} hands the batches it gives up on`,
    typed === undefined ? ['queue', 'topic'] : [typed],
  );
};

/** What a stream event's `destinations.onFailure.type` says its destination is (P264). */
const STREAM_FAILURE_TYPES: ReadonlyMap<string, DeployedKind> = new Map([
  ['sqs', 'queue'],
  ['sns', 'topic'],
]);

/** `schedule: rate(1 hour)`, or `schedule: { rate: [cron(...), ...], name, enabled }`: a clock. */
const readSchedule: EventReader = (value, site, reading) => {
  const settings = isRecord(value) ? value : { rate: value };
  const name = textOf(settings['name']);
  const rates = asList(settings['rate']);
  if (rates.length === 0) {
    eventRow(reading, site, 'subscription-source-unread', `${site.address} names no rate`, 'Write the schedule as rate(...) or cron(...).');
    return;
  }
  rates.forEach((rate, index) => {
    const expression = textOf(rate);
    deliver(
      reading,
      site,
      'schedule',
      { kind: 'schedule', ...(expression === undefined ? {} : { expression }) },
      disabled(settings) ? { disabled: true } : {},
      { ...(rates.length === 1 ? {} : { address: `${site.address}.rate[${index}]` }), ...(name === undefined ? {} : { name }) },
    );
  });
};

/** The bus a value names: a name, an ARN, a reference to a bus the file declares; `default` where none is. */
const busOf = (reading: EventReading, value: unknown, site: EventSite): string | undefined => {
  if (value === undefined || value === null) return DEFAULT_EVENT_BUS;
  const text = textOf(value);
  if (text !== undefined) return deployedNameIn(text)?.name ?? text;
  const found = sourceNamed(reading, value, site, `the bus ${site.address} takes events from`, ['bus']);
  return found?.kind === 'bus' ? found.name : undefined;
};

/** A pattern read, or the row saying why not. */
const patternOf = (reading: EventReading, site: EventSite, written: unknown) => {
  const pattern = eventPatternOf(written);
  if ('reason' in pattern) {
    eventRow(reading, site, 'event-pattern-unread', `the pattern of ${site.address} is not read: ${pattern.text}`, 'Write the pattern as a mapping of fields to lists of values.');
    return undefined;
  }
  return pattern;
};

/** `eventBridge: { eventBus, pattern, schedule, name }`: a rule on a bus, or a schedule. */
const readEventBridge: EventReader = (value, site, reading) => {
  if (!isRecord(value)) {
    eventRow(reading, site, 'event-pattern-unread', `${site.address} is not a mapping`, 'Write eventBridge as a mapping with a pattern or a schedule.');
    return;
  }
  const name = textOf(value['name']);
  const schedule = textOf(value['schedule']);
  if (schedule !== undefined) {
    deliver(reading, site, 'schedule', { kind: 'schedule', expression: schedule }, disabled(value) ? { disabled: true } : {}, name === undefined ? {} : { name });
    return;
  }
  const bus = busOf(reading, value['eventBus'], site);
  if (bus === undefined) return;
  const pattern = patternOf(reading, site, value['pattern']);
  if (pattern === undefined) return;
  deliver(reading, site, 'rule', { kind: 'bus', name: bus, pattern }, value['input'] === undefined && value['inputPath'] === undefined && value['inputTransformer'] === undefined ? {} : { transformed: true }, name === undefined ? {} : { name });
};

/** `cloudwatchEvent: { event }`: a rule on the default bus, as the framework's older event wrote it. */
const readCloudwatchEvent: EventReader = (value, site, reading) => {
  const settings = isRecord(value) ? value : {};
  const pattern = patternOf(reading, site, settings['event']);
  if (pattern === undefined) return;
  const name = textOf(settings['name']);
  deliver(reading, site, 'rule', { kind: 'bus', name: DEFAULT_EVENT_BUS, pattern }, disabled(settings) ? { disabled: true } : {}, name === undefined ? {} : { name });
};

/** `s3: <bucket>`, or `s3: { bucket, event, rules: [{ prefix }, { suffix }], existing }`: a notification of a bucket. */
const readS3: EventReader = (value, site, reading) => {
  const settings = settingsOf(value, 'bucket');
  const written = settings['bucket'];
  const found = textOf(written) === undefined ? reading.file.template.deployedOf(written) : undefined;
  const bucket = textOf(written) ?? (found !== undefined && !(found instanceof Unread) && found.kind === 'bucket' ? found.name : undefined);
  if (bucket === undefined) {
    eventRow(reading, site, 'bucket-notification-unread', `the bucket ${site.address} is notified of is not read${found instanceof Unread ? `: ${found.text}` : ''}`, 'Write the bucket name, or a Ref of a bucket the file declares.');
    return;
  }
  const rules = asList(settings['rules']).filter(isRecord);
  const prefix = rules.map((rule) => textOf(rule['prefix'])).find((text) => text !== undefined);
  const suffix = rules.map((rule) => textOf(rule['suffix'])).find((text) => text !== undefined);
  const event = textOf(settings['event']) ?? 's3:ObjectCreated:*';
  deliver(reading, site, 'notification', {
    kind: 'bucket',
    name: bucket,
    events: [event],
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  }, settings['existing'] === true ? { existing: true } : {});
};

/** `cognitoUserPool: { pool, trigger }`: a step of signing a person up or in, spelled as Terraform spells it. */
const readCognito: EventReader = (value, site, reading) => {
  const settings = isRecord(value) ? value : {};
  const pool = textOf(settings['pool']);
  const trigger = textOf(settings['trigger']);
  if (pool === undefined || trigger === undefined) {
    eventRow(reading, site, 'subscription-source-unread', `the ${pool === undefined ? 'pool' : 'trigger'} of ${site.address} is not read`, 'Write the pool and the trigger so the file settles them.');
    return;
  }
  const key = cognitoTriggerKey(pool, trigger);
  const step = key.slice(key.lastIndexOf('/') + 1);
  deliver(reading, site, 'trigger', { kind: 'trigger', service: 'cognito', key }, { pool, trigger: step }, { name: step });
};

/** Event types read as ways in, by the key they are written under. */
export const EVENT_READERS: ReadonlyMap<string, EventReader> = new Map<string, EventReader>([
  ['http', readHttp],
  ['httpApi', readHttpApi],
  ['websocket', readWebsocket],
  ['sqs', readSqs],
  ['sns', readSns],
  ['stream', readStream],
  ['schedule', readSchedule],
  ['eventBridge', readEventBridge],
  ['cloudwatchEvent', readCloudwatchEvent],
  ['s3', readS3],
  ['cognitoUserPool', readCognito],
]);

/** One event of a function, read by the reader for its type or said to be unread. */
export const readEvent = (event: unknown, site: EventSite, reading: EventReading): void => {
  const [type] = isRecord(event) ? Object.keys(event) : [];
  if (type === undefined || !isRecord(event)) return;
  const read = EVENT_READERS.get(type);
  if (read !== undefined) {
    read(event[type], site, reading);
    return;
  }
  eventRow(
    reading,
    site,
    'invoker-not-read',
    `${site.name ?? site.key} is run by ${type} events, which are not read, so nothing drawn reaches it that way`,
    'Events of this kind run the function outside anything this reads. Nothing to fix; the function is still in the graph under its name.',
    'info',
  );
};

/** A function URL: every verb and every path, straight to the function, keyed as Terraform keys one (P53). */
export const readFunctionUrl = (value: unknown, site: EventSite, reading: EventReading): void => {
  if (value === undefined || value === false || value === null) return;
  const settings = isRecord(value) ? value : {};
  const at = reading.file.siteOf(site.path);
  const authorizer = textOf(settings['authorizer']);
  reading.file.parts.routes.push({
    ...at,
    method: 'ALL',
    path: '/*',
    rawPath: '/*',
    target: { function: site.index },
    ...(authorizer === 'aws_iam' ? { guards: [{ label: 'AWS_IAM', ...at }] } : {}),
    meta: { declaredAs: site.address, key: makeFunctionUrlEntryKey(site.name ?? site.address), by: 'function-url' },
  });
};
