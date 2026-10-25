import { deployedArn } from '@flowatlas/aws';
import { only, XRAY_READS } from '../allow-list.js';
import { readAwsSpan, sendsOf, workflowName, type SpanAttributes } from '../aws.js';
import { pathOf, type AwsTransport, type FaasTrigger, type ObservedSpan, type SpanKind } from '../span.js';
import {
  Dropped,
  isObject,
  isoOfMs,
  list,
  ms2,
  Skips,
  statusOf,
  text,
  withFields,
  type Json,
  type TraceReader,
} from './shared.js';

/**
 * AWS X-Ray traces as `aws xray batch-get-traces` prints them (P108):
 * `{ Traces: [{ Id, Segments: [{ Id, Document }] }] }`, one output, an array
 * of outputs or one per line, or a bare array of segment documents.
 *
 * A `Document` is a JSON string holding the whole segment, annotations and
 * metadata included: it is parsed, read through `XRAY_READS` field by field,
 * and dropped (D1). What is read becomes the same span fields P107 reads from
 * OpenTelemetry, through `readAwsSpan`, so a function, a workflow and every
 * SDK call are named, cut and matched exactly as an OTLP span of them is.
 *
 * Two kinds of node carry nothing a span needs and are read through rather
 * than kept, their children hung on their parent: the `AWS::Lambda` segment
 * (the service's side of an invocation, above the function's own segment)
 * and a subsegment that names no call (`Invocation`, `Overhead`, one a team
 * made for its own code). That keeps a call's parent its function's segment,
 * the step it ran in, or the call that sent it, as P107's matcher reads it.
 */

type Role = 'function' | 'service' | 'workflow' | 'stage' | 'app' | 'inferred' | 'host' | 'state' | 'sdk' | 'remote' | 'none';

/** What a segment is, by its `origin`; any other origin is an instrumented application. */
const ORIGINS: Readonly<Record<string, Role>> = {
  'AWS::Lambda::Function': 'function',
  'AWS::Lambda': 'service',
  'AWS::StepFunctions::StateMachine': 'workflow',
  'AWS::ApiGateway::Stage': 'stage',
};

/** The few spellings of a service an SDK names otherwise than its `rpc.service`. */
const SERVICE_NAMES: Readonly<Record<string, string>> = {
  StepFunctions: 'SFN',
  'Step Functions': 'SFN',
  States: 'SFN',
  CloudWatchEvents: 'EventBridge',
};

/** An SDK subsegment's `aws` fields, under the attribute each is read as by `readAwsSpan`. */
const SDK_FIELDS: Readonly<Record<string, string>> = {
  queue_url: 'aws.sqs.queue_url',
  topic_arn: 'aws.sns.topic_arn',
  function_name: 'aws.lambda.function.name',
  state_machine_arn: 'aws.step_functions.state_machine.arn',
  bucket_name: 'aws.s3.bucket',
  stream_name: 'aws.kinesis.stream_name',
};

/** How a function was started, said by the span that started it. */
const TRANSPORT_TRIGGERS: Readonly<Record<AwsTransport, FaasTrigger>> = {
  sqs: 'pubsub',
  sns: 'pubsub',
  eventbridge: 'pubsub',
  kinesis: 'datasource',
  dynamodb: 'datasource',
  s3: 'datasource',
};

/**
 * X-Ray has no trigger field, but a function's segment hangs under what ran
 * it: a request through a stage, a step, an invoke, or a write or a send that
 * a mapping delivered. That parent says the trigger P107's matcher reads.
 */
const triggerOf = (parent: ObservedSpan | undefined): FaasTrigger | undefined => {
  if (parent === undefined) return undefined;
  if (parent.kind === 'server' && parent.method !== undefined) return 'http';
  if (parent.state !== undefined) return 'other';
  if (!sendsOf(parent)) return undefined;
  return parent.transport === undefined ? 'other' : TRANSPORT_TRIGGERS[parent.transport];
};

/** What a node hands its subsegments: who they ran in. */
interface Scope {
  traceId: string | undefined;
  service: string | undefined;
  /** The function's or the workflow's attributes, beneath every subsegment's own (as an OTLP resource). */
  resource: ReadonlyMap<string, string>;
  /** Set on a state machine's segment: its direct subsegments are its steps. */
  steps?: string;
}

/** A node read as a span, before its parent is known past the nodes read through. */
interface Pending {
  span: ObservedSpan;
  parent: string | undefined;
  /** A function's segment, whose trigger its parent says. */
  fn: boolean;
}

interface Walk {
  pending: Pending[];
  /** Nodes read through, by `<trace>/<id>`, to the parent their children hang on instead. */
  through: Map<string, string | undefined>;
  fallbackService: string | undefined;
  skips: Skips;
  dropped: Dropped;
}

const secondsToMs = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : undefined;

const attributes = (entries: Array<[string, string | undefined]>): Map<string, string> =>
  new Map(entries.filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ''));

/**
 * What a node is: a subsegment by where it sits and its namespace, a segment
 * by its origin. An inferred segment X-Ray drew for a remote host is named by
 * the host, so it is not read at all.
 */
const roleOf = (node: Json, subsegment: boolean, scope: Scope): Role => {
  if (subsegment) {
    if (scope.steps !== undefined) return 'state';
    const namespace = text(node['namespace']);
    if (namespace === 'aws') return 'sdk';
    if (namespace === 'remote' && isObject(node['http'])) return 'remote';
    return 'none';
  }
  if (node['inferred'] === true) return text(node['origin'])?.startsWith('AWS::') === true ? 'inferred' : 'host';
  const origin = text(node['origin']);
  return (origin === undefined ? undefined : ORIGINS[origin]) ?? 'app';
};

/** The request and the answer a node's `http` holds: method, path shape and status, nothing else. */
const httpOf = (node: Json, dropped: Dropped): { method?: string; path?: string; status?: number } => {
  dropped.outside(node['http'], XRAY_READS.http);
  const http = only(node['http'], XRAY_READS.http);
  dropped.outside(http['request'], XRAY_READS.request);
  dropped.outside(http['response'], XRAY_READS.response);
  const request = only(http['request'], XRAY_READS.request);
  const url = text(request['url']);
  return {
    method: text(request['method'])?.toUpperCase(),
    path: url === undefined ? undefined : pathOf(url),
    status: statusOf(only(http['response'], XRAY_READS.response)['status']),
  };
};

/** A stage's request path loses the stage it is served under: `/live/checkout` is `/checkout`. */
const withoutStage = (path: string | undefined, name: string | undefined): string | undefined => {
  const stage = name?.includes('/') === true ? name.slice(name.lastIndexOf('/') + 1) : undefined;
  if (path === undefined || stage === undefined || stage === '' || stage.startsWith('$')) return path;
  const prefix = `/${stage}`;
  return path === prefix ? '/' : path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
};

/** What one node is as a span, by its role; `undefined` reads it through. */
interface Shaped {
  kind: SpanKind;
  fields: Partial<ObservedSpan>;
  /** What its subsegments ran in, when it changes. */
  scope?: Partial<Scope>;
}

type Shape = (node: Json, scope: Scope, walk: Walk) => Shaped | undefined;

const awsOf = (node: Json, dropped: Dropped): Json => {
  dropped.outside(node['aws'], XRAY_READS.aws);
  return only(node['aws'], XRAY_READS.aws);
};

/** The strings of a field that is a string or a list of them. */
const names = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((name): name is string => typeof name === 'string' && name !== '');

const SHAPES: Readonly<Record<Role, Shape>> = {
  function: (node, scope, walk) => {
    const aws = awsOf(node, walk.dropped);
    const resource = attributes([
      ['faas.name', text(aws['function_name'])],
      ['cloud.resource_id', text(node['resource_arn']) ?? text(aws['function_arn'])],
    ]);
    return {
      kind: 'server',
      fields: { service: text(node['name']) ?? walk.fallbackService, ...readAwsSpan({ text: resource, lists: new Map() }) },
      scope: { service: text(node['name']) ?? walk.fallbackService, resource },
    };
  },
  service: () => undefined,
  workflow: (node, _scope, walk) => {
    const machine = workflowName(text(node['resource_arn'])) ?? text(node['name']);
    // The workflow by an ARN made from its name, as the OTLP resource says it, so `readAwsSpan` cuts it the same way.
    const resource = attributes([['cloud.resource_id', machine === undefined ? undefined : deployedArn('workflow', machine)]]);
    const service = text(node['name']) ?? walk.fallbackService;
    return {
      kind: 'server',
      fields: { service, ...readAwsSpan({ text: resource, lists: new Map() }) },
      scope: { service, resource, ...(machine === undefined ? {} : { steps: machine }) },
    };
  },
  // A stage's `name` is `<api>/<stage>`: the API's id is part of a host, so only the stage is read, to cut it off the path.
  stage: (node, _scope, walk) => {
    const http = httpOf(node, walk.dropped);
    return {
      kind: 'server',
      fields: { service: walk.fallbackService, method: http.method, path: withoutStage(http.path, text(node['name'])), status: http.status },
      scope: { service: walk.fallbackService, resource: new Map() },
    };
  },
  app: (node, _scope, walk) => {
    const http = httpOf(node, walk.dropped);
    const service = text(node['name']) ?? walk.fallbackService;
    return { kind: 'server', fields: { service, ...http }, scope: { service, resource: new Map() } };
  },
  // A node X-Ray drew for an AWS service that was called: the callee's side of the call above it.
  inferred: (node, _scope, walk) => ({
    kind: 'server',
    fields: { service: text(node['name']) ?? walk.fallbackService, status: httpOf(node, walk.dropped).status },
    scope: { resource: new Map() },
  }),
  host: () => undefined,
  state: (node, scope) => {
    const own = attributes([['aws.step_functions.state.name', text(node['name'])]]);
    return {
      kind: 'internal',
      fields: { service: scope.service, ...readAwsSpan({ text: new Map([...scope.resource, ...own]), lists: new Map() }) },
      scope: { steps: undefined },
    };
  },
  sdk: (node, scope, walk) => {
    const aws = awsOf(node, walk.dropped);
    const named = text(node['name']);
    const service = named === undefined ? undefined : (SERVICE_NAMES[named] ?? named);
    const operation = text(aws['operation']);
    if (service === undefined || operation === undefined) return undefined;
    const own = attributes([
      ['rpc.system', 'aws-api'],
      ['rpc.service', service],
      ['rpc.method', operation],
      ...Object.entries(SDK_FIELDS).map(([field, key]): [string, string | undefined] => [key, text(aws[field])]),
    ]);
    const tables = service === 'DynamoDB' ? names(aws['table_name'] ?? aws['resource_names']) : [];
    const attrs: SpanAttributes = {
      text: new Map([...scope.resource, ...own]),
      lists: new Map(tables.length === 0 ? [] : [['aws.dynamodb.table_names', tables]]),
    };
    const http = httpOf(node, walk.dropped);
    return { kind: 'client', fields: { service: scope.service, rpc: `${service}/${operation}`, status: http.status, ...readAwsSpan(attrs) } };
  },
  remote: (node, scope, walk) => {
    const http = httpOf(node, walk.dropped);
    if (http.method === undefined || http.path === undefined) return undefined;
    const fields: Partial<ObservedSpan> = { service: scope.service, ...http };
    // The function a call was made from, as an OTLP span of it says.
    if (scope.resource.size > 0) Object.assign(fields, { faas: readAwsSpan({ text: scope.resource, lists: new Map() }).faas });
    return { kind: 'client', fields };
  },
  none: () => undefined,
};

/** Why a node read through is not a span, by role, said once per node in the summary. */
const THROUGH: Partial<Readonly<Record<Role, readonly [noun: 'segment' | 'subsegment', why: string]>>> = {
  service: ['segment', 'of origin AWS::Lambda, read through to the function segment under it'],
  host: ['segment', 'inferred for a remote host (its name is the host)'],
  none: ['subsegment', 'naming no call, read through to the calls under them'],
  sdk: ['subsegment', 'of an AWS call without its service or operation'],
  remote: ['subsegment', 'of a remote call without a method and a URL'],
};

const readNode = (raw: unknown, parent: string | undefined, scope: Scope, walk: Walk, subsegment: boolean): void => {
  walk.dropped.outside(raw, XRAY_READS.document);
  const node = only(raw, XRAY_READS.document);
  const id = text(node['id']);
  const traceId = text(node['trace_id']) ?? scope.traceId;
  const isSub = subsegment || node['type'] === 'subsegment';
  if (id === undefined || traceId === undefined) {
    walk.skips.add(isSub ? 'subsegment' : 'segment', 'without an id and a trace id');
    return;
  }
  const role = roleOf(node, isSub, scope);
  const shaped = SHAPES[role](node, scope, walk);
  const childScope: Scope = { ...scope, traceId, ...(shaped?.scope ?? {}) };
  if (shaped === undefined) {
    const [noun, why] = THROUGH[role]!;
    walk.skips.add(noun, why);
    walk.through.set(`${traceId}/${id}`, parent);
  } else {
    const start = secondsToMs(node['start_time']);
    const end = secondsToMs(node['end_time']);
    const span = withFields(
      { traceId, spanId: id, kind: shaped.kind },
      {
        ...shaped.fields,
        at: isoOfMs(start),
        durationMs: start === undefined || end === undefined || end < start ? undefined : ms2(end - start),
        error: node['fault'] === true ? true : undefined,
      },
    );
    walk.pending.push({ span, parent, fn: role === 'function' });
  }
  for (const child of list(node['subsegments'])) readNode(child, id, childScope, walk, true);
};

/** How many nodes read through are followed up to a kept one. */
const MAX_HOPS = 64;

/** Hangs every span on its nearest ancestor that is one, and gives each function its trigger. */
const settle = (walk: Walk): ObservedSpan[] => {
  const kept = new Map(walk.pending.map(({ span }) => [`${span.traceId}/${span.spanId}`, span]));
  const parentOf = (traceId: string, raw: string | undefined): string | undefined => {
    let at = raw;
    for (let hops = 0; at !== undefined && hops < MAX_HOPS; hops += 1) {
      const key = `${traceId}/${at}`;
      if (kept.has(key) || !walk.through.has(key)) return at;
      at = walk.through.get(key);
    }
    return undefined;
  };
  for (const { span, parent } of walk.pending) {
    const parentId = parentOf(span.traceId, parent);
    if (parentId !== undefined) span.parentId = parentId;
  }
  for (const { span, fn } of walk.pending) {
    if (!fn || span.parentId === undefined) continue;
    const trigger = triggerOf(kept.get(`${span.traceId}/${span.parentId}`));
    if (trigger !== undefined) span.trigger = trigger;
  }
  return walk.pending.map(({ span }) => span);
};

const isOutput = (value: unknown): value is Json => isObject(value) && Array.isArray(value['Traces']);
const isSegmentDocument = (value: unknown): boolean =>
  isObject(value) && typeof value['id'] === 'string' && typeof value['trace_id'] === 'string' && 'start_time' in value;

/** The segment documents a file holds, each parsed from its string; one that does not parse is counted. */
const documentsIn = (document: unknown, skips: Skips, dropped: Dropped): unknown[] => {
  if (Array.isArray(document) && document.every(isSegmentDocument)) return document;
  const outputs = Array.isArray(document) ? document : [document];
  return outputs.flatMap((output) => {
    dropped.outside(output, XRAY_READS.output);
    return list(only(output, XRAY_READS.output)['Traces']).flatMap((trace) => {
      dropped.outside(trace, XRAY_READS.trace);
      return list(only(trace, XRAY_READS.trace)['Segments']).flatMap((segment) => {
        dropped.outside(segment, XRAY_READS.segment);
        const body = only(segment, XRAY_READS.segment)['Document'];
        if (isObject(body)) return [body];
        try {
          const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : undefined;
          if (isObject(parsed)) return [parsed];
        } catch {
          // Counted below, never kept.
        }
        skips.add('segment', 'whose document is not JSON');
        return [];
      });
    });
  });
};

export const xrayReader: TraceReader = {
  name: 'xray',
  sniff: (document) =>
    isOutput(document) ||
    (Array.isArray(document) && document.length > 0 && (document.every(isOutput) || document.every(isSegmentDocument))),
  read: (document, fallbackService) => {
    const walk: Walk = { pending: [], through: new Map(), fallbackService, skips: new Skips(), dropped: new Dropped() };
    for (const segment of documentsIn(document, walk.skips, walk.dropped)) {
      const parent = isObject(segment) ? text(segment['parent_id']) : undefined;
      readNode(segment, parent, { traceId: undefined, service: fallbackService, resource: new Map() }, walk, false);
    }
    return { spans: settle(walk), skipped: walk.skips.list(), droppedAttributes: walk.dropped.count };
  },
};
