import { destinationName, isAwsSpan, readAwsSpan, type SpanAttributes } from './aws.js';
import type { SkippedPart } from './readers.js';
import { keepAllowed, pathOf, type ObservedSpan } from './span.js';

/**
 * The parts the readers added beside `readers.ts` are built from (P112):
 * what a reader may be told beside the document, the error a refusal is, and
 * the small pieces every reader builds its spans with. A copy of the helpers
 * `readers.ts` keeps for OTLP and @nestjs/observe, so a reader in its own
 * file imports nothing at run time from `readers.ts`, which imports it.
 */

/** What a reader may be told beside the document (P112); every field is optional. */
export interface ReadContext {
  /** The sha256 of the file the document is in: a format with no ids of its own makes them from it. */
  source?: string;
  /** Where the project's front ends send their calls, asked only by a reader of a browser's record. */
  frontEnd?: () => FrontEndContext;
}

/** The project's front ends and the services their base URLs point at (P77, P112). */
export interface FrontEndContext {
  /** The services the map has browser calls (`ui_api_call`) for, sorted. */
  frontEnds: readonly string[];
  /**
   * The service a call from `frontEnd` to `origin` reaches, as the
   * configuration says, or nothing when nothing does. The origin is asked
   * about and never kept.
   */
  serviceAt(origin: string, frontEnd: string): string | undefined;
}

/**
 * A file a reader refuses (P112). The message says the format, the record's
 * index and the field only: a line of the file quoted in an error would be a
 * leak in a terminal or a CI log.
 */
export class TraceFileError extends Error {}

export type Json = Record<string, unknown>;

export const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Counts what was skipped, by noun and reason, in the order first seen. */
export class Skips {
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
export const withFields = (span: ObservedSpan, fields: Partial<ObservedSpan>): ObservedSpan => {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (span as unknown as Json)[key] = value;
  }
  return keepAllowed(span);
};

/** Counts keys a reader saw and did not read; the count is all that is kept of them. */
export class Dropped {
  count = 0;

  /** The keys of `value` outside `fields`. */
  outside(value: unknown, fields: readonly string[]): void {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) if (!fields.includes(key)) this.count += 1;
  }
}

/** Milliseconds to two decimals. */
export const ms2 = (ms: number): number => Math.round(ms * 100) / 100;

/** A duration a file states in milliseconds, to two decimals; nothing when it is not a number (I3). */
export const msOf = (value: unknown): number | undefined => {
  const ms = amount(value);
  return ms === undefined ? undefined : ms2(ms);
};

/** A time in microseconds since the epoch, as Zipkin and Jaeger write one, as ISO; nothing for 0 or none. */
export const microsToIso = (value: unknown): string | undefined => {
  const micros = amount(value);
  return micros === undefined || micros === 0 ? undefined : new Date(Math.floor(micros / 1000)).toISOString();
};

/** A duration in microseconds, in milliseconds to two decimals. */
export const microsToMs = (value: unknown): number | undefined => {
  const micros = amount(value);
  return micros === undefined ? undefined : ms2(micros / 1000);
};

/** An ISO string the reader trusts only once `Date.parse` does. */
export const isoOf = (value: unknown): string | undefined => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};

// --- span attributes --------------------------------------------------------

/**
 * The OTLP attribute keys read into span fields, for every format whose spans
 * carry OTel's keys (P112 D1): the Zipkin and Jaeger exports an OTel SDK
 * writes, whose tags are the same keys, so a key added to
 * `OTLP_READS.attributes` is reviewed once for all three. The same mapping as
 * `otlpSpan` in `readers.ts`, which keeps its own copy until the readers share
 * one module; the Zipkin and Jaeger tests check the two give the same spans.
 */

/** What a reader gathers of a span's attributes as it walks them: strings by key, and the few lists. */
export interface Attributes extends SpanAttributes {
  text: Map<string, string>;
  lists: Map<string, string[]>;
}

/** An empty gathering, to fill. */
export const noAttributes = (): Attributes => ({ text: new Map(), lists: new Map() });

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

/** An HTTP status, when the text is one. */
export const statusOf = (value: string | undefined): number | undefined => {
  const status = value === undefined ? NaN : Number(value);
  return Number.isInteger(status) && status >= 100 && status < 600 ? status : undefined;
};

/**
 * What a span's attributes say, as span fields: method, route, the shape of
 * its path, destination, symbol, collection, RPC, status and the cloud fields
 * (P107). `resource` holds what the span's resource says (a Lambda function's
 * name), under the span's own words. `http.path` is Brave's (Zipkin) and is
 * read only where a format's key set lets it through.
 */
export const fieldsOfAttributes = (read: SpanAttributes, resource?: SpanAttributes): Partial<ObservedSpan> => {
  const attrs = read.text;
  const both = resource === undefined ? read : { text: new Map([...resource.text, ...read.text]), lists: read.lists };
  const aws = isAwsSpan(both) ? readAwsSpan(both) : {};
  const url =
    attrs.get('url.full') ?? attrs.get('http.url') ?? attrs.get('url.path') ?? attrs.get('http.target') ?? attrs.get('http.path');
  return {
    method: (attrs.get('http.request.method') ?? attrs.get('http.method'))?.toUpperCase(),
    route: attrs.get('http.route'),
    path: url === undefined ? undefined : pathOf(url),
    destination: destinationName(attrs.get('messaging.destination.name') ?? attrs.get('messaging.destination')),
    symbol: symbolOf(attrs),
    collection: attrs.get('db.collection.name') ?? attrs.get('db.mongodb.collection') ?? attrs.get('db.sql.table'),
    rpc: rpcOf(attrs),
    status: statusOf(attrs.get('http.response.status_code') ?? attrs.get('http.status_code')),
    ...aws,
  };
};
