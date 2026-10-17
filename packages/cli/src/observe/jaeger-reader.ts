import { JAEGER_READS, only, OTLP_READS } from './allow-list.js';
import type { ObservedSpan, SpanKind } from './span.js';
import {
  Dropped,
  fieldsOfAttributes,
  noAttributes,
  isObject,
  list,
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
 * A Jaeger trace as its UI's "Download JSON" and its query API write it
 * (P112): `{ data: [{ traceID, spans, processes }] }`, a trace on its own
 * read too. A span's service is its process's `serviceName`; its parent the
 * first `CHILD_OF` reference, else the first `FOLLOWS_FROM`. Times are
 * microseconds. Tags (`{ key, type, value }`) go through OTLP's key set, so an
 * OTel SDK's spans read the same as from its OTLP file; operation names, logs,
 * warnings and process tags are never read.
 */

const TAGS: ReadonlySet<string> = new Set([...OTLP_READS.attributes, ...JAEGER_READS.tags]);

const KINDS: ReadonlyMap<string, SpanKind> = new Map([
  ['server', 'server'],
  ['client', 'client'],
  ['producer', 'producer'],
  ['consumer', 'consumer'],
  ['internal', 'internal'],
]);

const isTrace = (value: unknown): value is Json =>
  isObject(value) && typeof value['traceID'] === 'string' && Array.isArray(value['spans']);

/** The traces of a document: `{ data: [...] }`, or one trace. */
const tracesOf = (document: unknown): Json[] | undefined => {
  if (isTrace(document)) return [document];
  if (!isObject(document) || !Array.isArray(document['data'])) return undefined;
  const data = document['data'];
  return data.length > 0 && data.every(isTrace) ? (data as Json[]) : undefined;
};

/** The tags on the key set, by key; `bool` and `int64` values read as text. The rest counted, never looked at. */
const tagsOf = (tags: unknown, dropped: Dropped): Attributes => {
  const found = noAttributes();
  for (const raw of list(tags)) {
    const tag = only(raw, JAEGER_READS.tag);
    const key = tag['key'];
    if (typeof key !== 'string') continue;
    if (!TAGS.has(key)) {
      dropped.count += 1;
      continue;
    }
    const value = tag['value'];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') found.text.set(key, String(value));
  }
  return found;
};

/** `error: true` or OTel's status says an error; nothing else of it is read. */
const errorOf = (tags: ReadonlyMap<string, string>): true | undefined =>
  tags.get('error') === 'true' || tags.get('otel.status_code') === 'ERROR' ? true : undefined;

/** The first `CHILD_OF` reference's span, else the first `FOLLOWS_FROM`'s. */
const parentOf = (references: unknown): string | undefined => {
  const refs = list(references).map((ref) => only(ref, JAEGER_READS.reference));
  const of = (type: string): string | undefined => text(refs.find((ref) => ref['refType'] === type)?.['spanID']);
  return of('CHILD_OF') ?? of('FOLLOWS_FROM');
};

/** Each process's service name, by process id; its tags are never read. */
const servicesOf = (processes: unknown, dropped: Dropped): Map<string, string> => {
  const services = new Map<string, string>();
  if (!isObject(processes)) return services;
  for (const [id, process] of Object.entries(processes)) {
    dropped.outside(process, JAEGER_READS.process);
    const name = text(only(process, JAEGER_READS.process)['serviceName']);
    if (name !== undefined) services.set(id, name);
  }
  return services;
};

const jaegerSpan = (raw: unknown, services: ReadonlyMap<string, string>, fallbackService: string | undefined, dropped: Dropped): ObservedSpan | undefined => {
  dropped.outside(raw, JAEGER_READS.span);
  const span = only(raw, JAEGER_READS.span);
  const traceId = text(span['traceID']);
  const spanId = text(span['spanID']);
  if (traceId === undefined || spanId === undefined) return undefined;
  const tags = tagsOf(span['tags'], dropped);
  const process = text(span['processID']);
  return withFields(
    { traceId, spanId, kind: KINDS.get(tags.text.get('span.kind') ?? '') ?? 'internal' },
    {
      parentId: parentOf(span['references']),
      service: (process === undefined ? undefined : services.get(process)) ?? fallbackService,
      ...fieldsOfAttributes(tags),
      at: microsToIso(span['startTime']),
      durationMs: microsToMs(span['duration']),
      error: errorOf(tags.text),
    },
  );
};

export const jaegerReader: TraceReader = {
  name: 'jaeger',
  sniff: (document) => tracesOf(document) !== undefined,
  read: (document, fallbackService) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const spans: ObservedSpan[] = [];
    if (!isTrace(document)) dropped.outside(document, JAEGER_READS.document);
    for (const raw of tracesOf(document) ?? []) {
      dropped.outside(raw, JAEGER_READS.trace);
      const trace = only(raw, JAEGER_READS.trace);
      const services = servicesOf(trace['processes'], dropped);
      for (const one of list(trace['spans'])) {
        const span = jaegerSpan(one, services, fallbackService, dropped);
        if (span === undefined) skips.add('span', 'without a trace id and a span id');
        else spans.push(span);
      }
    }
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};
