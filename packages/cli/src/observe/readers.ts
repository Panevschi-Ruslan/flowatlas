import { NESTJS_OBSERVE_READS, only, OTLP_READS } from './allow-list.js';
import { pathOf, type ObservedSpan, type SpanKind } from './span.js';

/**
 * One way a trace file can be written, as a Strategy: `sniff` says whether a
 * parsed document is this format, `read` turns it into spans. Readers are pure
 * and copy over only the fields their allow-list names (`allow-list.ts`), so a
 * header, a query string, a body or a statement never leaves the reader.
 */
export interface TraceReader {
  name: string;
  sniff(document: unknown): boolean;
  read(document: unknown, fallbackService?: string): TraceRead;
}

/** Parts of a file a reader saw and did not read, counted so nothing is dropped unsaid. */
export interface SkippedPart {
  noun: 'snapshot' | 'job' | 'node' | 'span';
  /** Why, as it reads after the noun: `of protocol ws`, `without o, c and m`. */
  why: string;
  count: number;
}

export interface TraceRead {
  spans: ObservedSpan[];
  skipped: SkippedPart[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Counts what was skipped, by noun and reason, in the order first seen. */
class Skips {
  private readonly parts = new Map<string, SkippedPart>();

  add(noun: SkippedPart['noun'], why: string): void {
    const key = `${noun}\u0000${why}`;
    const part = this.parts.get(key);
    if (part === undefined) this.parts.set(key, { noun, why, count: 1 });
    else part.count += 1;
  }

  list(): SkippedPart[] {
    return [...this.parts.values()];
  }
}

/** Sets the fields that have a value, so a span never carries `undefined`. */
const withFields = (span: ObservedSpan, fields: Partial<ObservedSpan>): ObservedSpan => {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (span as unknown as Json)[key] = value;
  }
  return span;
};

// --- OTLP/JSON -------------------------------------------------------------

const OTLP_ATTRIBUTES: ReadonlySet<string> = new Set(OTLP_READS.attributes);

/** OTLP attribute values are wrapped by type; only the listed keys, and only strings and numbers. */
const otlpAttributes = (attributes: unknown, allowed: ReadonlySet<string>): Map<string, string> => {
  const found = new Map<string, string>();
  for (const attribute of list(attributes)) {
    if (!isObject(attribute) || typeof attribute['key'] !== 'string' || !allowed.has(attribute['key'])) continue;
    const value = attribute['value'];
    const scalar = isObject(value) ? (value['stringValue'] ?? value['intValue']) : value;
    if (typeof scalar === 'string' || typeof scalar === 'number') found.set(attribute['key'], String(scalar));
  }
  return found;
};

const OTLP_KINDS: ReadonlyMap<string, SpanKind> = new Map([
  ['1', 'internal'],
  ['2', 'server'],
  ['3', 'client'],
  ['4', 'producer'],
  ['5', 'consumer'],
  ['SPAN_KIND_INTERNAL', 'internal'],
  ['SPAN_KIND_SERVER', 'server'],
  ['SPAN_KIND_CLIENT', 'client'],
  ['SPAN_KIND_PRODUCER', 'producer'],
  ['SPAN_KIND_CONSUMER', 'consumer'],
]);

const lastPart = (dotted: string): string => dotted.split(/[.:/\\]/).filter(Boolean).pop() ?? dotted;

/** `Class.method` from the code attributes, old and new conventions. */
const symbolOf = (attrs: ReadonlyMap<string, string>): string | undefined => {
  const fn = attrs.get('code.function.name') ?? attrs.get('code.function');
  if (fn === undefined) return undefined;
  const namespace = attrs.get('code.namespace');
  return namespace === undefined || fn.includes('.') ? fn : `${lastPart(namespace)}.${fn}`;
};

const rpcOf = (attrs: ReadonlyMap<string, string>): string | undefined => {
  const service = attrs.get('rpc.service');
  const method = attrs.get('rpc.method');
  if (service === undefined && method === undefined) return undefined;
  return [service, method].filter(Boolean).join('/');
};

const nanosOf = (value: unknown): number => (typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN);

const nanosToIso = (value: unknown): string | undefined => {
  const nanos = nanosOf(value);
  return Number.isFinite(nanos) && nanos > 0 ? new Date(Math.floor(nanos / 1e6)).toISOString() : undefined;
};

const statusOf = (value: string | undefined): number | undefined => {
  const status = value === undefined ? NaN : Number(value);
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined;
};

/** OTLP's status code 2 is an error; nothing else of the status is read. */
const otlpError = (status: unknown): true | undefined => {
  const code = only(status, OTLP_READS.spanStatus)['code'];
  return code === 2 || code === 'STATUS_CODE_ERROR' ? true : undefined;
};

const otlpSpan = (raw: unknown, service: string | undefined): ObservedSpan | undefined => {
  const span = only(raw, OTLP_READS.span);
  const traceId = text(span['traceId']);
  const spanId = text(span['spanId']);
  if (traceId === undefined || spanId === undefined) return undefined;
  const attrs = otlpAttributes(span['attributes'], OTLP_ATTRIBUTES);
  const url = attrs.get('url.full') ?? attrs.get('http.url') ?? attrs.get('url.path') ?? attrs.get('http.target');
  const method = attrs.get('http.request.method') ?? attrs.get('http.method');
  const start = nanosOf(span['startTimeUnixNano']);
  const end = nanosOf(span['endTimeUnixNano']);
  return withFields(
    { traceId, spanId, kind: OTLP_KINDS.get(String(span['kind'] ?? '1')) ?? 'internal' },
    {
      parentId: text(span['parentSpanId']),
      service,
      method: method?.toUpperCase(),
      route: attrs.get('http.route'),
      path: url === undefined ? undefined : pathOf(url),
      destination: attrs.get('messaging.destination.name') ?? attrs.get('messaging.destination'),
      symbol: symbolOf(attrs),
      collection: attrs.get('db.collection.name') ?? attrs.get('db.mongodb.collection') ?? attrs.get('db.sql.table'),
      rpc: rpcOf(attrs),
      at: nanosToIso(span['startTimeUnixNano']),
      status: statusOf(attrs.get('http.response.status_code') ?? attrs.get('http.status_code')),
      durationMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1e6 : undefined,
      error: otlpError(span['status']),
    },
  );
};

const RESOURCE_ATTRIBUTES: ReadonlySet<string> = new Set(OTLP_READS.resourceAttributes);

export const otlpReader: TraceReader = {
  name: 'otlp',
  sniff: (document) => isObject(document) && Array.isArray(document['resourceSpans']),
  read: (document, fallbackService) => {
    const spans: ObservedSpan[] = [];
    const skips = new Skips();
    for (const raw of list((document as Json)['resourceSpans'])) {
      const resource = only(raw, ['resource', ...OTLP_READS.scopes]);
      const resAttrs = otlpAttributes(only(resource['resource'], OTLP_READS.resource)['attributes'], RESOURCE_ATTRIBUTES);
      const service = resAttrs.get('service.name') ?? fallbackService;
      const scopes = OTLP_READS.scopes.flatMap((key) => list(resource[key]));
      for (const scope of scopes) {
        for (const span of list(only(scope, OTLP_READS.scope)['spans'])) {
          const read = otlpSpan(span, service);
          if (read === undefined) skips.add('span', 'without a trace id and a span id');
          else spans.push(read);
        }
      }
    }
    return { spans, skipped: skips.list() };
  },
};

// --- @nestjs/observe -------------------------------------------------------

/**
 * A telemetry batch as the SDK posts it, `{ serviceId, snapshots, jobs, ... }`,
 * or a bare array of request snapshots someone exported by hand. A snapshot
 * has its trace id in `ti`, its protocol in `p`, the operation the router
 * matched in `op`, the answer in `a` (`m` method, `sc` status, `ou` original
 * URL) and its span tree in `t`. A tree node is `{ o, c, m, t, ch }`: origin,
 * class, method key, tags, children; `n`, a name, is optional and not read.
 */
const isSnapshot = (value: unknown): boolean => isObject(value) && typeof value['ti'] === 'string';

const isBatch = (document: unknown): document is Json =>
  isObject(document) &&
  Array.isArray(document['snapshots']) &&
  (document['serviceId'] === undefined || typeof document['serviceId'] === 'string');

const isSnapshotArray = (document: unknown): document is unknown[] =>
  Array.isArray(document) && document.length > 0 && document.every(isObject) && document.some(isSnapshot);

/** HTTP is the one protocol whose operation is a route; the others wait for their entry kinds. */
const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(['http', 'https']);

/** The databases the SDK records calls to; `m` is `<command> <collection>`, or the SQL operation. */
const DATABASES: ReadonlySet<string> = new Set(['mongodb', 'pg', 'mysql2']);

const METHOD_AND_PATH = /^([A-Z]+)\s+(\/\S*)$/;
const HTTP_METHOD = /^[A-Z]+$/;

/** `ct`, the time the request came in, as an ISO string the reader trusts only once `Date.parse` does. */
const isoOf = (value: unknown): string | undefined => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};

const errorOf = (value: unknown): true | undefined =>
  value === undefined || value === null || value === false ? undefined : true;

/** A node the contract accepts: origin, class and method key, all three said. */
const isNode = (node: Json): boolean =>
  text(node['o']) !== undefined && text(node['c']) !== undefined && text(node['m']) !== undefined;

interface TreeContext {
  traceId: string;
  rootId: string;
  service: string | undefined;
  at: string | undefined;
  spans: ObservedSpan[];
  skips: Skips;
}

/** One node of a tree as a span: an outgoing request, a database call, or a method. */
const nodeSpan = (node: Json, base: ObservedSpan, skips: Skips): ObservedSpan | undefined => {
  const className = node['c'] as string;
  const methodKey = node['m'] as string;
  const fields = { durationMs: amount(node['d']), error: errorOf(node['e']) };
  if (className === 'http') {
    const tags = only(node['t'], NESTJS_OBSERVE_READS.tags);
    const url = text(tags['http.url']);
    const path = url === undefined ? undefined : pathOf(url);
    // `m` is `<METHOD> <host>`: the method is kept, the host never.
    const word = methodKey.split(/\s+/)[0] ?? '';
    const method = text(tags['http.method'])?.toUpperCase() ?? (HTTP_METHOD.test(word) ? word : undefined);
    if (path === undefined || method === undefined) {
      skips.add('node', 'of class http without a method and a URL');
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

const walkTree = (roots: unknown, context: TreeContext): void => {
  let counter = 0;
  const walk = (raw: unknown, parentId: string): void => {
    const node = only(raw, NESTJS_OBSERVE_READS.node);
    let under = parentId;
    if (isNode(node)) {
      counter += 1;
      const spanId = `${context.rootId}:${counter}`;
      const base: ObservedSpan = { traceId: context.traceId, spanId, parentId, kind: 'internal' };
      if (context.service !== undefined) base.service = context.service;
      if (context.at !== undefined) base.at = context.at;
      const span = nodeSpan(node, base, context.skips);
      if (span !== undefined) {
        context.spans.push(span);
        under = spanId;
      }
    } else {
      context.skips.add('node', 'without o, c and m');
    }
    for (const child of list(node['ch'])) walk(child, under);
  };
  // The contract sends an array; one node on its own is read too.
  for (const root of Array.isArray(roots) ? roots : isObject(roots) ? [roots] : []) walk(root, context.rootId);
};

const snapshotSpans = (raw: unknown, index: number, service: string | undefined, skips: Skips): ObservedSpan[] => {
  const snapshot = only(raw, NESTJS_OBSERVE_READS.snapshot);
  const traceId = text(snapshot['ti']);
  if (traceId === undefined) {
    skips.add('snapshot', 'without a trace id');
    return [];
  }
  const answer = only(snapshot['a'], NESTJS_OBSERVE_READS.answer);
  const protocol = text(snapshot['p'])?.toLowerCase();
  // A hand export may leave the protocol out; a method in the answer still says HTTP.
  const http = protocol === undefined ? text(answer['m']) !== undefined : HTTP_PROTOCOLS.has(protocol);
  if (!http) {
    skips.add('snapshot', `of protocol ${protocol ?? '(none)'}`);
    return [];
  }
  const operation = text(snapshot['op']);
  const paired = operation === undefined ? null : METHOD_AND_PATH.exec(operation);
  const url = text(answer['ou']);
  const route = paired?.[2] ?? (operation?.startsWith('/') ? operation : undefined);
  const path = url === undefined ? undefined : pathOf(url);
  if (route === undefined && path === undefined) skips.add('snapshot', 'without a route or a URL');
  const at = isoOf(snapshot['ct']);
  const rootId = `${traceId}:${index}`;
  const root = withFields(
    { traceId, spanId: rootId, kind: 'server' },
    {
      service,
      method: text(answer['m'])?.toUpperCase() ?? paired?.[1],
      route,
      path,
      at,
      status: Number.isInteger(answer['sc']) ? (answer['sc'] as number) : undefined,
      durationMs: amount(snapshot['d']),
      error: errorOf(snapshot['e']),
    },
  );
  const spans: ObservedSpan[] = [root];
  walkTree(snapshot['t'], { traceId, rootId, service, at, spans, skips });
  return spans;
};

/** A job is read for its span tree only: its own entry kind is not mapped yet. */
const jobSpans = (raw: unknown, index: number, service: string | undefined, skips: Skips): ObservedSpan[] => {
  const job = only(raw, NESTJS_OBSERVE_READS.job);
  if (!Array.isArray(job['t']) && !isObject(job['t'])) {
    skips.add('job', 'without a span tree');
    return [];
  }
  const traceId = text(job['ti']) ?? `job:${index}`;
  const spans: ObservedSpan[] = [];
  walkTree(job['t'], { traceId, rootId: `${traceId}:job:${index}`, service, at: isoOf(job['ct']), spans, skips });
  return spans;
};

export const nestjsObserveReader: TraceReader = {
  name: 'nestjs-observe',
  sniff: (document) => isBatch(document) || isSnapshotArray(document),
  read: (document, fallbackService) => {
    const batch = isBatch(document) ? only(document, NESTJS_OBSERVE_READS.batch) : { snapshots: document };
    const service = text(batch['serviceId']) ?? fallbackService;
    const skips = new Skips();
    const spans = [
      ...list(batch['snapshots']).flatMap((snapshot, index) => snapshotSpans(snapshot, index, service, skips)),
      ...list(batch['jobs']).flatMap((job, index) => jobSpans(job, index, service, skips)),
    ];
    return { spans, skipped: skips.list() };
  },
};

/** Every format known, tried in order; the first whose sniff says yes reads the file. */
export const TRACE_READERS: ReadonlyMap<string, TraceReader> = new Map(
  [otlpReader, nestjsObserveReader].map((reader) => [reader.name, reader]),
);

export const readerFor = (document: unknown): TraceReader | undefined =>
  [...TRACE_READERS.values()].find((reader) => reader.sniff(document));
