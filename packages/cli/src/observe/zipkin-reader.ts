import { only, OTLP_READS, ZIPKIN_READS } from './allow-list.js';
import type { ObservedSpan, SpanKind } from './span.js';
import {
  Dropped,
  fieldsOfAttributes,
  noAttributes,
  isObject,
  microsToIso,
  microsToMs,
  Skips,
  text,
  withFields,
  type Attributes,
  type Json,
} from './reader-parts.js';
import type { TraceReader } from './readers.js';

/**
 * Zipkin v2 JSON (P112): what the Zipkin UI's JSON button and its API give, a
 * list of spans `{ traceId, id, parentId, kind, timestamp, duration,
 * localEndpoint, tags }`, or a list of traces, each a list of spans. Times are
 * microseconds. Tags are read through OTLP's key set, so the export of an OTel
 * SDK gives the same spans as its OTLP file, plus the few Brave names that
 * differ (`http.path`); a span's name, annotations and endpoints are never read.
 */

const TAGS: ReadonlySet<string> = new Set([...OTLP_READS.attributes, ...ZIPKIN_READS.tags]);

const KINDS: ReadonlyMap<string, SpanKind> = new Map([
  ['SERVER', 'server'],
  ['CLIENT', 'client'],
  ['PRODUCER', 'producer'],
  ['CONSUMER', 'consumer'],
]);

const isZipkinSpan = (value: unknown): boolean =>
  isObject(value) && typeof value['traceId'] === 'string' && typeof value['id'] === 'string';

/** The spans of a document: a flat list, or a list of traces. */
const spansOf = (document: unknown): unknown[] =>
  Array.isArray(document) ? document.flatMap((item) => (Array.isArray(item) ? item : [item])) : [];

/** A list of spans with ids, one of them at least placed by an endpoint or a time. */
const sniff = (document: unknown): boolean => {
  const spans = spansOf(document);
  const placed = (span: Json): boolean => isObject(span['localEndpoint']) || span['timestamp'] !== undefined;
  return spans.length > 0 && spans.every(isZipkinSpan) && (spans as Json[]).some(placed);
};

/** The tags on the key set, as strings; the rest counted and never looked at. */
const tagsOf = (tags: unknown, dropped: Dropped): Attributes => {
  const found = noAttributes();
  if (!isObject(tags)) return found;
  for (const [key, value] of Object.entries(tags)) {
    if (!TAGS.has(key)) {
      dropped.count += 1;
      continue;
    }
    // An error's text is not held even here: that the tag is there is all that is read.
    if (key === 'error') found.text.set(key, '');
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') found.text.set(key, String(value));
  }
  return found;
};

/** An `error` tag, whatever its text, or OTel's status, is an error; the text is not kept. */
const errorOf = (tags: ReadonlyMap<string, string>): true | undefined =>
  tags.has('error') || tags.get('otel.status_code') === 'ERROR' ? true : undefined;

const zipkinSpan = (raw: unknown, fallbackService: string | undefined, dropped: Dropped): ObservedSpan | undefined => {
  dropped.outside(raw, ZIPKIN_READS.span);
  const span = only(raw, ZIPKIN_READS.span);
  const traceId = text(span['traceId']);
  const spanId = text(span['id']);
  if (traceId === undefined || spanId === undefined) return undefined;
  dropped.outside(span['localEndpoint'], ZIPKIN_READS.localEndpoint);
  const endpoint = only(span['localEndpoint'], ZIPKIN_READS.localEndpoint);
  const tags = tagsOf(span['tags'], dropped);
  return withFields(
    { traceId, spanId, kind: KINDS.get(String(span['kind'] ?? '')) ?? 'internal' },
    {
      parentId: text(span['parentId']),
      service: text(endpoint['serviceName']) ?? fallbackService,
      ...fieldsOfAttributes(tags),
      at: microsToIso(span['timestamp']),
      durationMs: microsToMs(span['duration']),
      error: errorOf(tags.text),
    },
  );
};

export const zipkinReader: TraceReader = {
  name: 'zipkin',
  sniff,
  read: (document, fallbackService) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const spans: ObservedSpan[] = [];
    for (const raw of spansOf(document)) {
      const span = zipkinSpan(raw, fallbackService, dropped);
      if (span === undefined) skips.add('span', 'without a trace id and a span id');
      else spans.push(span);
    }
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};
