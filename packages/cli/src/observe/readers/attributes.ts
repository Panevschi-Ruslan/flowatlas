import { destinationName, isAwsSpan, readAwsSpan, type SpanAttributes } from '../aws.js';
import { pathOf, type ObservedSpan } from '../span.js';
import { statusOf } from './shared.js';

/**
 * The OTLP attribute keys read into span fields, for every format whose spans
 * carry OTel's keys (P112 D1): OTLP itself, and the Zipkin and Jaeger exports
 * an OTel SDK writes, whose tags are the same keys. One mapping, so a key
 * added to `OTLP_READS.attributes` is reviewed once for all three; the Zipkin
 * and Jaeger tests check their spans equal OTLP's for the same traffic.
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

/**
 * What a span's attributes say, as span fields: method, route, the shape of
 * its path, destination, symbol, collection, RPC, status and the cloud fields
 * (P107). `resource` holds what the span's resource says (a Lambda function's
 * name), under the span's own words. `http.path` is Brave's (Zipkin) and is
 * read only where a format's key set lets it through.
 */
export const fieldsOfAttributes = (read: SpanAttributes, resource?: SpanAttributes): Partial<ObservedSpan> => {
  const attrs = read.text;
  // A Lambda function's resource says which function every span of it ran in; the span's own word wins.
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
