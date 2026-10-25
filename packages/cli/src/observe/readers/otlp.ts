import { only, OTLP_READS } from '../allow-list.js';
import type { ObservedSpan, SpanKind } from '../span.js';
import { fieldsOfAttributes, noAttributes, type Attributes } from './attributes.js';
import { Dropped, isObject, list, ms2, Skips, text, withFields, type Json, type TraceReader } from './shared.js';

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

/**
 * OTLP attribute values are wrapped by type; only the listed keys, and only
 * strings and numbers, or a list of strings under a key `OTLP_LISTS` names. A
 * key off the list is counted and its value never looked at, so a header or a
 * statement is not held past this loop.
 */
const otlpAttributes = (attributes: unknown, allowed: ReadonlySet<string>, dropped: Dropped): Attributes => {
  const found = noAttributes();
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

/** OTLP's status code 2 is an error; nothing else of the status is read. */
const otlpError = (status: unknown): true | undefined => {
  const code = only(status, OTLP_READS.spanStatus)['code'];
  return code === 2 || code === 'STATUS_CODE_ERROR' ? true : undefined;
};

const otlpSpan = (raw: unknown, resource: Attributes, service: string | undefined, dropped: Dropped): ObservedSpan | undefined => {
  const span = only(raw, OTLP_READS.span);
  const traceId = text(span['traceId']);
  const spanId = text(span['spanId']);
  if (traceId === undefined || spanId === undefined) return undefined;
  const read = otlpAttributes(span['attributes'], OTLP_ATTRIBUTES, dropped);
  const start = nanosOf(span['startTimeUnixNano']);
  const end = nanosOf(span['endTimeUnixNano']);
  return withFields(
    { traceId, spanId, kind: OTLP_KINDS.get(String(span['kind'] ?? '1')) ?? 'internal' },
    {
      parentId: text(span['parentSpanId']),
      service,
      // The mapping Zipkin and Jaeger share (P112): one place a key is read.
      ...fieldsOfAttributes(read, resource),
      at: nanosToIso(start),
      durationMs: durationOf(start, end),
      error: otlpError(span['status']),
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
