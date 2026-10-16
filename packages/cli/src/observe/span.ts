/**
 * One span from a trace file, reduced to what can name a place in the code.
 *
 * Readers build these and nothing else leaves a reader: header values, query
 * strings, ids in a path, message bodies and database statements are never
 * copied in. A path keeps its shape and loses its query; a template keeps its
 * parameters by name only.
 */
export type SpanKind = 'server' | 'client' | 'producer' | 'consumer' | 'internal';

export interface ObservedSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  /** `service.name` of the resource, or what the user said with `--service`. */
  service?: string;
  kind: SpanKind;
  /** Upper-case HTTP method. */
  method?: string;
  /** Route template as the framework declared it (`/orders/:id`, `/orders/{id}`). */
  route?: string;
  /** Request path without query or fragment; only used when there is no template. */
  path?: string;
  /** Queue, topic or bus name. */
  destination?: string;
  /** `ClassName.method`, or a bare function name. */
  symbol?: string;
  /** Collection or table name. */
  collection?: string;
  /** `service/method` of an RPC call. */
  rpc?: string;
  /** ISO time the span started, when the file says. */
  at?: string;
}

/** What a path segment that holds a value is replaced with; it matches only a route parameter. */
export const VALUE = ':value';

/** A segment that carries a value rather than a name: any digit, or a long token. */
const isValue = (segment: string): boolean => /\d/.test(segment) || segment.length > 32;

/**
 * Path only: no scheme, host, query or fragment, and every segment that looks
 * like a value (an id, a number, a token) replaced with `VALUE`.
 */
export const pathOf = (url: string): string | undefined => {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://local').pathname;
  } catch {
    return undefined;
  }
  return pathname
    .split('/')
    .map((segment) => (segment !== '' && isValue(segment) ? VALUE : segment))
    .join('/');
};
