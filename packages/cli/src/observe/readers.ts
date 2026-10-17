import { NESTJS_OBSERVE_READS, only, OTLP_READS } from './allow-list.js';
import { destinationName, isAwsSpan, readAwsSpan } from './aws.js';
import { keepAllowed, pathOf, type ObservedSpan, type SpanKind } from './span.js';

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
  /**
   * Attribute keys seen and not read (OTLP attributes, @nestjs/observe fields
   * and tags), counted each time one is seen: the file's privacy block says
   * how many, never which.
   */
  droppedAttributes: number;
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

/** Sets the fields that have a value, then keeps only the allowed ones (`keepAllowed`). */
const withFields = (span: ObservedSpan, fields: Partial<ObservedSpan>): ObservedSpan => {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (span as unknown as Json)[key] = value;
  }
  return keepAllowed(span);
};

/** Counts keys a reader saw and did not read; the count is all that is kept of them. */
class Dropped {
  count = 0;

  /** The keys of `value` outside `fields`. */
  outside(value: unknown, fields: readonly string[]): void {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) if (!fields.includes(key)) this.count += 1;
  }
}

/** Milliseconds to two decimals. */
const ms2 = (ms: number): number => Math.round(ms * 100) / 100;

/** A duration a batch states in milliseconds, to two decimals; nothing when it is not a number (I3). */
const msOf = (value: unknown): number | undefined => {
  const ms = amount(value);
  return ms === undefined ? undefined : ms2(ms);
};

// --- OTLP/JSON -------------------------------------------------------------

const OTLP_ATTRIBUTES: ReadonlySet<string> = new Set(OTLP_READS.attributes);

/** The attributes read as a list of names (P107); a list under any other key is not read. */
export const OTLP_LISTS: ReadonlySet<string> = new Set(OTLP_READS.listAttributes);

const scalarOf = (value: unknown): string | undefined => {
  const scalar = isObject(value) ? (value['stringValue'] ?? value['intValue']) : value;
  return typeof scalar === 'string' || typeof scalar === 'number' ? String(scalar) : undefined;
};

/** The strings of an OTLP `arrayValue`, `{ values: [{ stringValue }, ...] }`; a bare array is read too. */
const listOf = (value: unknown): string[] | undefined => {
  const array = isObject(value) && isObject(value['arrayValue']) ? value['arrayValue']['values'] : value;
  if (!Array.isArray(array)) return undefined;
  const names = array.flatMap((item) => {
    const name = scalarOf(item);
    return name === undefined || name === '' ? [] : [name];
  });
  return names.length === 0 ? undefined : names;
};

/** What an attribute list held that the reader reads: strings by key, and the few lists. */
interface OtlpAttributes {
  text: Map<string, string>;
  lists: Map<string, string[]>;
}

/**
 * OTLP attribute values are wrapped by type; only the listed keys, and only
 * strings and numbers, or a list of strings under a key `OTLP_LISTS` names. A
 * key off the list is counted and its value never looked at, so a header or a
 * statement is not held past this loop.
 */
const otlpAttributes = (attributes: unknown, allowed: ReadonlySet<string>, dropped: Dropped): OtlpAttributes => {
  const found: OtlpAttributes = { text: new Map(), lists: new Map() };
  for (const attribute of list(attributes)) {
    if (!isObject(attribute) || typeof attribute['key'] !== 'string') continue;
    const key = attribute['key'];
    if (!allowed.has(key)) {
      dropped.count += 1;
      continue;
    }
    if (OTLP_LISTS.has(key)) {
      const names = listOf(attribute['value']);
      if (names !== undefined) found.lists.set(key, names);
      continue;
    }
    const scalar = scalarOf(attribute['value']);
    if (scalar !== undefined) found.text.set(key, scalar);
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

/** A 64-bit time as the JSON writes it, a string or a number, read without losing a nanosecond. */
const nanosOf = (value: unknown): bigint | undefined => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : undefined;
};

const nanosToIso = (nanos: bigint | undefined): string | undefined =>
  nanos === undefined || nanos === 0n ? undefined : new Date(Number(nanos / 1_000_000n)).toISOString();

/** End minus start in milliseconds, two decimals; nothing when either is missing or the end is first (I3). */
const durationOf = (start: bigint | undefined, end: bigint | undefined): number | undefined =>
  start === undefined || end === undefined || start === 0n || end < start ? undefined : ms2(Number(end - start) / 1e6);

const statusOf = (value: string | undefined): number | undefined => {
  const status = value === undefined ? NaN : Number(value);
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined;
};

/** OTLP's status code 2 is an error; nothing else of the status is read. */
const otlpError = (status: unknown): true | undefined => {
  const code = only(status, OTLP_READS.spanStatus)['code'];
  return code === 2 || code === 'STATUS_CODE_ERROR' ? true : undefined;
};

const otlpSpan = (raw: unknown, resource: OtlpAttributes, service: string | undefined, dropped: Dropped): ObservedSpan | undefined => {
  const span = only(raw, OTLP_READS.span);
  const traceId = text(span['traceId']);
  const spanId = text(span['spanId']);
  if (traceId === undefined || spanId === undefined) return undefined;
  const read = otlpAttributes(span['attributes'], OTLP_ATTRIBUTES, dropped);
  const attrs = read.text;
  // A Lambda function's resource says which function every span of it ran in; the span's own word wins.
  const both = { text: new Map([...resource.text, ...read.text]), lists: read.lists };
  const aws = isAwsSpan(both) ? readAwsSpan(both) : {};
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
      destination: destinationName(attrs.get('messaging.destination.name') ?? attrs.get('messaging.destination')),
      symbol: symbolOf(attrs),
      collection: attrs.get('db.collection.name') ?? attrs.get('db.mongodb.collection') ?? attrs.get('db.sql.table'),
      rpc: rpcOf(attrs),
      at: nanosToIso(start),
      status: statusOf(attrs.get('http.response.status_code') ?? attrs.get('http.status_code')),
      durationMs: durationOf(start, end),
      error: otlpError(span['status']),
      ...aws,
    },
  );
};

const RESOURCE_ATTRIBUTES: ReadonlySet<string> = new Set(OTLP_READS.resourceAttributes);

/**
 * Every attribute key an OTLP reader reads, of a span or of its resource: the
 * protobuf decoder (`otlp-protobuf.ts`) drops the rest while it walks the
 * bytes, before an attribute object exists.
 */
export const OTLP_KEEP: ReadonlySet<string> = new Set([...OTLP_READS.attributes, ...OTLP_READS.resourceAttributes]);

export const otlpReader: TraceReader = {
  name: 'otlp',
  sniff: (document) => isObject(document) && Array.isArray(document['resourceSpans']),
  read: (document, fallbackService) => {
    const spans: ObservedSpan[] = [];
    const skips = new Skips();
    const dropped = new Dropped();
    // A request decoded from protobuf counted what it dropped on the way in.
    const decoded = (document as Json)['droppedAttributes'];
    if (typeof decoded === 'number' && Number.isInteger(decoded) && decoded > 0) dropped.count += decoded;
    for (const raw of list((document as Json)['resourceSpans'])) {
      const resource = only(raw, ['resource', ...OTLP_READS.scopes]);
      const resAttrs = otlpAttributes(only(resource['resource'], OTLP_READS.resource)['attributes'], RESOURCE_ATTRIBUTES, dropped);
      const service = resAttrs.text.get('service.name') ?? fallbackService;
      resAttrs.text.delete('service.name');
      const scopes = OTLP_READS.scopes.flatMap((key) => list(resource[key]));
      for (const scope of scopes) {
        for (const span of list(only(scope, OTLP_READS.scope)['spans'])) {
          const read = otlpSpan(span, resAttrs, service, dropped);
          if (read === undefined) skips.add('span', 'without a trace id and a span id');
          else spans.push(read);
        }
      }
    }
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
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
  dropped: Dropped;
}

/** One node of a tree as a span: an outgoing request, a database call, or a method. */
const nodeSpan = (node: Json, base: ObservedSpan, skips: Skips, dropped: Dropped): ObservedSpan | undefined => {
  const className = node['c'] as string;
  const methodKey = node['m'] as string;
  const fields = { durationMs: msOf(node['d']), error: errorOf(node['e']) };
  dropped.outside(node['t'], className === 'http' ? NESTJS_OBSERVE_READS.tags : []);
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
    context.dropped.outside(raw, NESTJS_OBSERVE_READS.node);
    const node = only(raw, NESTJS_OBSERVE_READS.node);
    let under = parentId;
    if (isNode(node)) {
      counter += 1;
      const spanId = `${context.rootId}:${counter}`;
      const base: ObservedSpan = { traceId: context.traceId, spanId, parentId, kind: 'internal' };
      if (context.service !== undefined) base.service = context.service;
      if (context.at !== undefined) base.at = context.at;
      const span = nodeSpan(node, base, context.skips, context.dropped);
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

interface BatchContext {
  service: string | undefined;
  skips: Skips;
  dropped: Dropped;
}

const snapshotSpans = (raw: unknown, index: string, { service, skips, dropped }: BatchContext): ObservedSpan[] => {
  dropped.outside(raw, NESTJS_OBSERVE_READS.snapshot);
  const snapshot = only(raw, NESTJS_OBSERVE_READS.snapshot);
  const traceId = text(snapshot['ti']);
  if (traceId === undefined) {
    skips.add('snapshot', 'without a trace id');
    return [];
  }
  dropped.outside(snapshot['a'], NESTJS_OBSERVE_READS.answer);
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
      durationMs: msOf(snapshot['d']),
      error: errorOf(snapshot['e']),
    },
  );
  const spans: ObservedSpan[] = [root];
  walkTree(snapshot['t'], { traceId, rootId, service, at, spans, skips, dropped });
  return spans;
};

/** A job is read for its span tree only: its own entry kind is not mapped yet. */
const jobSpans = (raw: unknown, index: string, { service, skips, dropped }: BatchContext): ObservedSpan[] => {
  dropped.outside(raw, NESTJS_OBSERVE_READS.job);
  const job = only(raw, NESTJS_OBSERVE_READS.job);
  if (!Array.isArray(job['t']) && !isObject(job['t'])) {
    skips.add('job', 'without a span tree');
    return [];
  }
  const traceId = text(job['ti']) ?? `job:${index}`;
  const spans: ObservedSpan[] = [];
  walkTree(job['t'], { traceId, rootId: `${traceId}:job:${index}`, service, at: isoOf(job['ct']), spans, skips, dropped });
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
  sniff: (document) => isBatchSeries(document) || isBatch(document) || isSnapshotArray(document),
  read: (document, fallbackService) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const spans = batchesOf(document, dropped).flatMap((batch, at) => {
      const context = { service: text(batch['serviceId']) ?? fallbackService, skips, dropped };
      // The first batch's spans keep the ids they always had; a later batch's say which batch.
      const key = (index: number): string => (at === 0 ? String(index) : `${at}.${index}`);
      return [
        ...list(batch['snapshots']).flatMap((snapshot, index) => snapshotSpans(snapshot, key(index), context)),
        ...list(batch['jobs']).flatMap((job, index) => jobSpans(job, key(index), context)),
      ];
    });
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};

/** Every format known, tried in order; the first whose sniff says yes reads the file. */
export const TRACE_READERS: ReadonlyMap<string, TraceReader> = new Map(
  [otlpReader, nestjsObserveReader].map((reader) => [reader.name, reader]),
);

export const readerFor = (document: unknown): TraceReader | undefined =>
  [...TRACE_READERS.values()].find((reader) => reader.sniff(document));
