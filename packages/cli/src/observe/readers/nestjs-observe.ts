import { NESTJS_OBSERVE_READS, only } from '../allow-list.js';
import { pathOf, type ObservedSpan } from '../span.js';
import { shapeOf, type Shape } from '@flowatlas/core';
import {
  Dropped,
  isObject,
  isoOfText,
  list,
  msOf,
  shapeOfText,
  Skips,
  statusOf,
  text,
  withFields,
  type Json,
  type SpanBodies,
  type TraceReader,
} from './shared.js';

// --- @nestjs/observe -------------------------------------------------------

/**
 * A telemetry batch as the SDK posts it to `<endpoint>/applications/telemetry`
 * (JSON, gzipped): `{ serviceId, snapshots, jobs?, ... }`, or a bare array of
 * request snapshots someone exported by hand. Checked against the SDK's own
 * wire contract in 0.3.12 (`dist/agent/telemetry-wire-contract.js`, P202);
 * a later version is read the same way, field by field, and a field it adds
 * is dropped until it is listed in `NESTJS_OBSERVE_READS`.
 *
 * A request snapshot has its trace id in `ti`, when it came in (`ct`, ISO),
 * how long it took (`d`, ms), its protocol (`p`), its operation (`op`), the
 * answer (`a`: `m` method, `sc` status, `ou` original URL) and its span tree
 * (`t`). What a snapshot is depends on its protocol:
 *
 *  - `http` / `https`: a server span. `op` is the route template Nest matched
 *    (`/invoices/:id`); a request that matched none carries its URL folded
 *    instead (query cut, UUIDs as `:id`), read as the URL's path shape. Over
 *    HTTP a GraphQL operation keeps protocol `http` and its `op` is the root
 *    field (`Query.invoices`), with the document in `ou`: its tree is read and
 *    the operation is not mapped.
 *  - `ws`: a message to a gateway, `op` `<Gateway>:<event>`: a consumer span
 *    of the event.
 *  - a broker transport (`KAFKA`, `NATS`, `REDIS`, `MQTT`, `RMQ`): a consumer
 *    span of the topic, subject, channel or pattern in `op`.
 *  - any other transport (`TCP`, `GRPC`, a custom one): a server span of the
 *    RPC pattern in `op`.
 *  - `graphql`, an operation outside an HTTP request: its tree only.
 *
 * A job (`jobs`) is a queued or scheduled run: `q` the queue, `c` when it was
 * called (ISO), `s` `completed` or `failed`, `d` ms, and the same tree. A
 * queue's job is a consumer span of the queue; a `@nestjs/schedule` run
 * (`q` is `cron`, `interval`, `timeout` or `schedule`) is read for its tree.
 *
 * A tree node is `{ o, c, m, d, so, e, t, ch }`: origin, class, method key,
 * duration, start offset from the trace's start, error, tags, children. A
 * `manual` node is a span the code opened inside a method and carries that
 * method's class and key, so it is not a call of its own: its children are
 * read under the method. A node the agent folded (`observe.collapsed: N` in
 * its tags) stands for N calls, its duration their sum, and is read as N
 * spans of the mean duration.
 *
 * `ti` is the inbound `x-request-id` the agent adopted, or an id it minted
 * (a UUID v7), never a W3C trace id; the agent sends it on as `x-request-id`
 * on the HTTP calls it records, so the service that answers one, read with
 * the same agent, reports the same `ti` (`match.ts` pairs the two).
 *
 * With `--shapes` (P113), and only then, the captured request's `rq.body` is
 * walked for its shape and dropped (`requestShape`); its headers never are.
 */
const isSnapshot = (value: unknown): boolean => isObject(value) && typeof value['ti'] === 'string';

const isBatch = (document: unknown): document is Json =>
  isObject(document) &&
  Array.isArray(document['snapshots']) &&
  (document['serviceId'] === undefined || typeof document['serviceId'] === 'string');

const isSnapshotArray = (document: unknown): document is unknown[] =>
  Array.isArray(document) && document.length > 0 && document.every(isObject) && document.some(isSnapshot);

/** What a snapshot of each protocol is read as (see above). */
type SnapshotKind = 'http' | 'event' | 'consumer' | 'rpc' | 'graphql';

/** The protocols that name what a snapshot is; any other is an RPC transport. Lower case. */
const PROTOCOLS: ReadonlyMap<string, SnapshotKind> = new Map([
  ['http', 'http'],
  ['https', 'http'],
  ['ws', 'event'],
  ['graphql', 'graphql'],
  ['kafka', 'consumer'],
  ['nats', 'consumer'],
  ['redis', 'consumer'],
  ['mqtt', 'consumer'],
  ['rmq', 'consumer'],
]);

/** The queue names `@nestjs/schedule` runs are reported under: a timer, not a queue. */
const SCHEDULES: ReadonlySet<string> = new Set(['cron', 'interval', 'timeout', 'schedule']);

/** The databases the SDK records calls to; `m` is `<command> <collection>`, or the SQL operation and its table. */
const DATABASES: ReadonlySet<string> = new Set(['mongodb', 'pg', 'mysql2']);

/** The tag a node the agent folded says how many calls it stands for under. */
const COLLAPSED = 'observe.collapsed';

/** A hand export's `op`, `METHOD /template`. */
const METHOD_AND_PATH = /^([A-Z]+)\s+(\/\S*)$/;
const HTTP_METHOD = /^[A-Z]+$/;
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

const errorOf = (value: unknown): true | undefined =>
  value === undefined || value === null || value === false ? undefined : true;

/**
 * The operation the agent sends for a request no route matched: its URL with
 * the query cut and each UUID segment as `:id` (the SDK's `fallbackOperationId`).
 */
const foldedUrl = (url: string): string => (url.split('?')[0] ?? '').replace(UUID_SEGMENT, '/:id');

/** A URL the answer holds, or nothing when `ou` is not one (a GraphQL document). */
const urlOf = (value: unknown): string | undefined => {
  const url = text(value);
  return url !== undefined && (url.startsWith('/') || /^https?:\/\//i.test(url)) ? url : undefined;
};

/** A time `offset` ms after `at`, as ISO. */
const plusMs = (at: string | undefined, offset: unknown): string | undefined => {
  const ms = msOf(offset);
  if (at === undefined || ms === undefined) return at;
  return new Date(Date.parse(at) + ms).toISOString();
};

/** A node the contract accepts: origin, class and method key, all three said. */
const isNode = (node: Json): boolean =>
  text(node['o']) !== undefined && text(node['c']) !== undefined && text(node['m']) !== undefined;

interface TreeContext {
  traceId: string;
  rootId: string;
  service: string | undefined;
  /** When the trace started: a node starts `so` ms after it. */
  at: string | undefined;
  spans: ObservedSpan[];
  skips: Skips;
  dropped: Dropped;
}

/** One node of a tree as a span: an outgoing request, a database call, or a method. */
const nodeSpan = (node: Json, tags: Json, base: ObservedSpan, durationMs: number | undefined, skips: Skips): ObservedSpan | undefined => {
  const className = node['c'] as string;
  const methodKey = node['m'] as string;
  const fields = { durationMs, error: errorOf(node['e']) };
  if (className === 'http') {
    const url = text(tags['http.url']);
    const path = url === undefined ? undefined : pathOf(url);
    // `m` is `<METHOD> <host>`: the method is kept, the host never.
    const word = methodKey.split(/\s+/)[0] ?? '';
    const method = text(tags['http.method'])?.toUpperCase() ?? (HTTP_METHOD.test(word) ? word : undefined);
    if (path === undefined || method === undefined) {
      // A folded node keeps none of its calls' tags, so none of their URLs.
      skips.add('node', tags[COLLAPSED] === undefined ? 'of class http without a method and a URL' : 'of class http folded by the agent, without its URLs');
      return undefined;
    }
    return withFields({ ...base, kind: 'client' }, { method, path, ...fields });
  }
  if (DATABASES.has(className)) {
    const collection = methodKey.split(/\s+/)[1];
    if (collection === undefined || collection === '') {
      skips.add('node', `of class ${className} without a collection`);
      return undefined;
    }
    return withFields({ ...base, kind: 'client' }, { collection, ...fields });
  }
  return withFields({ ...base, kind: 'internal' }, { symbol: `${className}.${methodKey}`, ...fields });
};

/** How many calls a node stands for: one, or what the agent folded into it. */
const callsOf = (tags: Json): number => {
  const calls = tags[COLLAPSED];
  return typeof calls === 'number' && Number.isInteger(calls) && calls > 1 ? Math.min(calls, 10_000) : 1;
};

const walkTree = (roots: unknown, context: TreeContext): void => {
  let counter = 0;
  const walk = (raw: unknown, parentId: string): void => {
    context.dropped.outside(raw, NESTJS_OBSERVE_READS.node);
    const node = only(raw, NESTJS_OBSERVE_READS.node);
    let under = parentId;
    if (!isNode(node)) {
      context.skips.add('node', 'without o, c and m');
    } else if (node['o'] !== 'manual') {
      // A manual node names the method it was opened in: that method's node is the call.
      const className = node['c'] as string;
      context.dropped.outside(node['t'], className === 'http' ? NESTJS_OBSERVE_READS.tags : [COLLAPSED]);
      const tags = only(node['t'], className === 'http' ? NESTJS_OBSERVE_READS.tags : [COLLAPSED]);
      const calls = callsOf(tags);
      const total = msOf(node['d']);
      const durationMs = total === undefined ? undefined : msOf(total / calls);
      const at = plusMs(context.at, node['so']);
      for (let call = 0; call < calls; call += 1) {
        counter += 1;
        const spanId = `${context.rootId}:${counter}`;
        const base: ObservedSpan = { traceId: context.traceId, spanId, parentId, kind: 'internal' };
        if (context.service !== undefined) base.service = context.service;
        if (at !== undefined) base.at = at;
        const span = nodeSpan(node, tags, base, durationMs, context.skips);
        if (span === undefined) continue;
        context.spans.push(span);
        // The children of a folded node are its calls' children, read under the first.
        if (call === 0) under = spanId;
      }
    }
    for (const child of list(node['ch'])) walk(child, under);
  };
  // The contract sends an array; one node on its own is read too.
  for (const root of Array.isArray(roots) ? roots : isObject(roots) ? [roots] : []) walk(root, context.rootId);
};

interface BatchContext {
  service: string | undefined;
  skips: Skips;
  dropped: Dropped;
  /** Set with `--shapes`: each snapshot's request body shape goes here, by its server span. */
  bodies?: SpanBodies[];
}

/**
 * The shape of the body a snapshot captured (P113): `rq.body`, the JSON text
 * the agent serialised (an object in a hand export), walked and dropped here.
 * A body the agent cut to its size limit is counted, not read.
 */
const requestShape = (raw: unknown, { skips, dropped }: BatchContext): Shape | undefined => {
  const { rq } = only(raw, NESTJS_OBSERVE_READS.shapesSnapshot);
  if (!isObject(rq)) return undefined;
  dropped.outside(rq, NESTJS_OBSERVE_READS.capturedRequest);
  const { body, bodyTruncated } = only(rq, NESTJS_OBSERVE_READS.capturedRequest);
  if (body === undefined || body === null) return undefined;
  if (bodyTruncated === true) {
    skips.add('body', 'cut short by the agent');
    return undefined;
  }
  return typeof body === 'string' ? shapeOfText(body, undefined, skips) : shapeOf(body);
};

/** The HTTP fields of a snapshot: method, route template and path shape, or why it has none. */
const httpFields = (snapshot: Json, answer: Json): Partial<ObservedSpan> | 'graphql' => {
  const operation = text(snapshot['op']);
  const url = urlOf(answer['ou']);
  const paired = operation === undefined ? null : METHOD_AND_PATH.exec(operation);
  // Over HTTP, a GraphQL operation is named by its root field, and `ou` holds the document.
  if (operation !== undefined && paired === null && !operation.startsWith('/')) return 'graphql';
  let route = paired?.[2] ?? operation;
  // The URL folded, sent for a request no route matched, may hold ids: its path shape stands in.
  if (route !== undefined && url !== undefined && route === foldedUrl(url) && pathOf(route) !== route) route = undefined;
  return {
    method: text(answer['m'])?.toUpperCase() ?? paired?.[1],
    route,
    path: url === undefined ? undefined : pathOf(url),
  };
};

/** The span a snapshot is, by its protocol, or nothing when only its tree is read. */
const rootOf = (snapshot: Json, answer: Json, rootId: string, traceId: string, context: BatchContext): ObservedSpan | undefined => {
  const { service, skips } = context;
  const protocol = text(snapshot['p'])?.toLowerCase();
  const operation = text(snapshot['op']);
  // A hand export may leave the protocol out; a method in the answer, or an operation that is a path, still says HTTP.
  const saysHttp = text(answer['m']) !== undefined || (operation !== undefined && (operation.startsWith('/') || METHOD_AND_PATH.test(operation)));
  const kind: SnapshotKind | undefined =
    protocol === undefined ? (saysHttp ? 'http' : undefined) : (PROTOCOLS.get(protocol) ?? 'rpc');
  const common = {
    service,
    at: isoOfText(snapshot['ct']),
    durationMs: msOf(snapshot['d']),
    error: errorOf(snapshot['e']),
  };
  if (kind === undefined) {
    skips.add('snapshot', 'without a protocol');
    return undefined;
  }
  if (kind === 'http') {
    const fields = httpFields(snapshot, answer);
    if (fields === 'graphql') {
      skips.add('snapshot', 'of a GraphQL operation, read for its spans only');
      return undefined;
    }
    if (fields.route === undefined && fields.path === undefined) skips.add('snapshot', 'without a route or a URL');
    return withFields({ traceId, spanId: rootId, kind: 'server' }, { ...fields, ...common, status: statusOf(answer['sc']) });
  }
  if (kind === 'graphql') {
    skips.add('snapshot', 'of a GraphQL operation, read for its spans only');
    return undefined;
  }
  if (operation === undefined) {
    skips.add('snapshot', `of protocol ${protocol} without an operation`);
    return undefined;
  }
  if (kind === 'event') {
    // `<Gateway>:<event>`: a class name holds no colon, so the event is what follows the first.
    const colon = operation.indexOf(':');
    const event = colon === -1 ? operation : operation.slice(colon + 1);
    return withFields({ traceId, spanId: rootId, kind: 'consumer' }, { destination: event, ...common });
  }
  if (kind === 'consumer') return withFields({ traceId, spanId: rootId, kind: 'consumer' }, { destination: operation, ...common });
  return withFields({ traceId, spanId: rootId, kind: 'server' }, { rpc: operation, ...common });
};

const snapshotSpans = (raw: unknown, index: string, context: BatchContext): ObservedSpan[] => {
  const { service, skips, dropped } = context;
  dropped.outside(raw, context.bodies === undefined ? NESTJS_OBSERVE_READS.snapshot : [...NESTJS_OBSERVE_READS.snapshot, ...NESTJS_OBSERVE_READS.shapesSnapshot]);
  const snapshot = only(raw, NESTJS_OBSERVE_READS.snapshot);
  const traceId = text(snapshot['ti']);
  if (traceId === undefined) {
    skips.add('snapshot', 'without a trace id');
    return [];
  }
  dropped.outside(snapshot['a'], NESTJS_OBSERVE_READS.answer);
  const answer = only(snapshot['a'], NESTJS_OBSERVE_READS.answer);
  const rootId = `${traceId}:${index}`;
  const root = rootOf(snapshot, answer, rootId, traceId, context);
  const spans: ObservedSpan[] = root === undefined ? [] : [root];
  if (root?.kind === 'server' && root.rpc === undefined && context.bodies !== undefined) {
    const request = requestShape(raw, context);
    if (request !== undefined) context.bodies.push({ traceId, spanId: rootId, request });
  }
  walkTree(snapshot['t'], { traceId, rootId, service, at: isoOfText(snapshot['ct']), spans, skips, dropped });
  return spans;
};

/** A job: a consumer span of its queue, or (a scheduled run) its tree only. */
const jobSpans = (raw: unknown, index: string, { service, skips, dropped }: BatchContext): ObservedSpan[] => {
  dropped.outside(raw, NESTJS_OBSERVE_READS.job);
  const job = only(raw, NESTJS_OBSERVE_READS.job);
  // A job reports under the trace of the request that queued it, when one did.
  const traceId = text(job['ti']) ?? `job:${index}`;
  const rootId = `${traceId}:job:${index}`;
  const at = isoOfText(job['c']);
  const queue = text(job['q']);
  const spans: ObservedSpan[] = [];
  if (queue !== undefined && !SCHEDULES.has(queue)) {
    spans.push(
      withFields(
        { traceId, spanId: rootId, kind: 'consumer' },
        {
          service,
          destination: queue,
          at,
          durationMs: msOf(job['d']),
          error: job['s'] === 'failed' ? true : errorOf(job['e']),
        },
      ),
    );
  } else if (!Array.isArray(job['t']) && !isObject(job['t'])) {
    skips.add('job', queue === undefined ? 'without a queue or a span tree' : 'without a span tree');
    return [];
  }
  walkTree(job['t'], { traceId, rootId, service, at, spans, skips, dropped });
  return spans;
};

/**
 * A saved series of batch posts, `{ batches: [batch, ...] }` (P105): read as
 * the batches one after another.
 */
const isBatchSeries = (document: unknown): document is Json =>
  isObject(document) && Array.isArray(document['batches']) && document['batches'].length > 0 && document['batches'].every(isBatch);

/** The batches a document holds: a series, one batch, or a bare array of snapshots as one. */
const batchesOf = (document: unknown, dropped: Dropped): Json[] => {
  if (isBatchSeries(document)) {
    dropped.outside(document, ['batches']);
    return (document['batches'] as Json[]).map((batch) => {
      dropped.outside(batch, NESTJS_OBSERVE_READS.batch);
      return only(batch, NESTJS_OBSERVE_READS.batch);
    });
  }
  if (isBatch(document)) {
    dropped.outside(document, NESTJS_OBSERVE_READS.batch);
    return [only(document, NESTJS_OBSERVE_READS.batch)];
  }
  return [{ snapshots: document }];
};

export const nestjsObserveReader: TraceReader = {
  name: 'nestjs-observe',
  carriesBodies: true,
  sniff: (document) => isBatchSeries(document) || isBatch(document) || isSnapshotArray(document),
  read: (document, fallbackService, options) => {
    const skips = new Skips();
    const dropped = new Dropped();
    // A document after the first of a file, or a post after the first a listener took (P109), says which,
    // so two posts' snapshots that share a trace id stay two.
    const part = options?.part === undefined || options.part === 0 ? '' : `${options.part}/`;
    const bodies: SpanBodies[] | undefined = options?.shapes === true ? [] : undefined;
    const spans = batchesOf(document, dropped).flatMap((batch, at) => {
      const context: BatchContext = {
        service: text(batch['serviceId']) ?? fallbackService,
        skips,
        dropped,
        ...(bodies === undefined ? {} : { bodies }),
      };
      // The first batch's spans keep the ids they always had; a later batch's say which batch.
      const key = (index: number): string => `${part}${at === 0 ? String(index) : `${at}.${index}`}`;
      return [
        ...list(batch['snapshots']).flatMap((snapshot, index) => snapshotSpans(snapshot, key(index), context)),
        ...list(batch['jobs']).flatMap((job, index) => jobSpans(job, key(index), context)),
      ];
    });
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count, ...(bodies === undefined ? {} : { bodies }) };
  },
};
