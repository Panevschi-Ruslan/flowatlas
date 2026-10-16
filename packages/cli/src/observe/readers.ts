import { pathOf, type ObservedSpan, type SpanKind } from './span.js';

/**
 * One way a trace file can be written, as a Strategy: `sniff` says whether a
 * parsed document is this format, `read` turns it into spans. Readers are pure
 * and copy over only the attributes listed here, so a header, a query string, a
 * body or a statement never leaves the reader.
 */
export interface TraceReader {
  name: string;
  sniff(document: unknown): boolean;
  read(document: unknown, fallbackService?: string): ObservedSpan[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// --- OTLP/JSON -------------------------------------------------------------

/** OTLP attribute values are wrapped by type; only strings name anything here. */
const otlpAttributes = (attributes: unknown): Map<string, string> => {
  const found = new Map<string, string>();
  for (const attribute of list(attributes)) {
    if (!isObject(attribute) || typeof attribute['key'] !== 'string') continue;
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

const nanosToIso = (value: unknown): string | undefined => {
  const nanos = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(nanos) && nanos > 0 ? new Date(Math.floor(nanos / 1e6)).toISOString() : undefined;
};

const otlpSpan = (span: Json, service: string | undefined): ObservedSpan | undefined => {
  const traceId = text(span['traceId']);
  const spanId = text(span['spanId']);
  if (traceId === undefined || spanId === undefined) return undefined;
  const attrs = otlpAttributes(span['attributes']);
  const url = attrs.get('url.full') ?? attrs.get('http.url') ?? attrs.get('url.path') ?? attrs.get('http.target');
  const method = attrs.get('http.request.method') ?? attrs.get('http.method');
  const fields: Partial<ObservedSpan> = {
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
  };
  const out: ObservedSpan = {
    traceId,
    spanId,
    kind: OTLP_KINDS.get(String(span['kind'] ?? '1')) ?? 'internal',
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (out as unknown as Json)[key] = value;
  }
  return out;
};

export const otlpReader: TraceReader = {
  name: 'otlp',
  sniff: (document) => isObject(document) && Array.isArray(document['resourceSpans']),
  read: (document, fallbackService) => {
    const spans: ObservedSpan[] = [];
    for (const resource of list((document as Json)['resourceSpans'])) {
      if (!isObject(resource)) continue;
      const resAttrs = otlpAttributes(isObject(resource['resource']) ? resource['resource']['attributes'] : []);
      const service = resAttrs.get('service.name') ?? fallbackService;
      const scopes = [...list(resource['scopeSpans']), ...list(resource['instrumentationLibrarySpans'])];
      for (const scope of scopes) {
        if (!isObject(scope)) continue;
        for (const span of list(scope['spans'])) {
          const read = isObject(span) ? otlpSpan(span, service) : undefined;
          if (read !== undefined) spans.push(read);
        }
      }
    }
    return spans;
  },
};

// --- @nestjs/observe -------------------------------------------------------

/** A node of the span tree: `n` name, `c` class, `m` method key, `ch` children. */
const isTreeSpan = (value: unknown): value is Json => isObject(value) && typeof value['n'] === 'string';

/** A request snapshot carries its trace id as `ti` and its request as `p`/`op`/`a`. */
const isSnapshot = (value: unknown): value is Json =>
  isObject(value) && typeof value['ti'] === 'string' && (value['p'] !== undefined || value['op'] !== undefined);

const snapshotsOf = (document: unknown): Json[] => {
  if (Array.isArray(document)) return document.filter(isSnapshot);
  if (isSnapshot(document)) return [document];
  if (!isObject(document)) return [];
  return Object.values(document).flatMap((value) => (Array.isArray(value) ? value.filter(isSnapshot) : []));
};

/** The span trees a snapshot holds, wherever it keeps them. */
const rootsOf = (snapshot: Json): Json[] =>
  Object.entries(snapshot).flatMap(([key, value]) =>
    key === 'a' ? [] : isTreeSpan(value) ? [value] : Array.isArray(value) ? value.filter(isTreeSpan) : [],
  );

const METHOD_AND_PATH = /^([A-Z]+)\s+(\/\S*)$/;

const msToIso = (value: unknown): string | undefined =>
  typeof value === 'number' && value > 0 ? new Date(value).toISOString() : undefined;

const nestjsSpans = (snapshot: Json, index: number, service: string | undefined): ObservedSpan[] => {
  const traceId = snapshot['ti'] as string;
  const request = isObject(snapshot['a']) ? snapshot['a'] : {};
  const operation = text(snapshot['op']);
  const paired = operation === undefined ? null : METHOD_AND_PATH.exec(operation);
  const method = text(request['m'])?.toUpperCase() ?? paired?.[1];
  const route = paired?.[2] ?? (operation?.startsWith('/') ? operation : undefined);
  const path = text(snapshot['p']);
  const at = msToIso(snapshot['ts'] ?? snapshot['t']);
  const rootId = `${traceId}:${index}`;
  const root: ObservedSpan = { traceId, spanId: rootId, kind: 'server' };
  if (service !== undefined) root.service = service;
  if (method !== undefined) root.method = method;
  if (route !== undefined) root.route = route;
  const shaped = path === undefined ? undefined : pathOf(path);
  if (shaped !== undefined) root.path = shaped;
  if (at !== undefined) root.at = at;
  const spans: ObservedSpan[] = [root];

  let counter = 0;
  const walk = (node: Json, parentId: string): void => {
    counter += 1;
    const spanId = `${rootId}:${counter}`;
    const className = text(node['c']);
    const methodKey = text(node['m']);
    const name = node['n'] as string;
    const symbol = className !== undefined && methodKey !== undefined ? `${className}.${methodKey}` : name;
    const span: ObservedSpan = { traceId, spanId, parentId, kind: 'internal', symbol };
    if (service !== undefined) span.service = service;
    if (at !== undefined) span.at = at;
    spans.push(span);
    for (const child of list(node['ch'])) if (isTreeSpan(child)) walk(child, spanId);
  };
  for (const tree of rootsOf(snapshot)) walk(tree, rootId);
  return spans;
};

export const nestjsObserveReader: TraceReader = {
  name: 'nestjs-observe',
  sniff: (document) => snapshotsOf(document).length > 0,
  read: (document, fallbackService) => {
    const service = (snapshot: Json): string | undefined =>
      text(snapshot['sv']) ?? text(snapshot['service']) ?? fallbackService;
    return snapshotsOf(document).flatMap((snapshot, index) => nestjsSpans(snapshot, index, service(snapshot)));
  },
};

/** Every format known, tried in order; the first whose sniff says yes reads the file. */
export const TRACE_READERS: ReadonlyMap<string, TraceReader> = new Map(
  [otlpReader, nestjsObserveReader].map((reader) => [reader.name, reader]),
);

export const readerFor = (document: unknown): TraceReader | undefined =>
  [...TRACE_READERS.values()].find((reader) => reader.sniff(document));
