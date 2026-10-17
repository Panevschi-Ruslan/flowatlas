/**
 * What each trace reader may look at (P85), one constant per reader.
 *
 * An allow-list, not a deny-list: a reader first copies a record down to the
 * fields named here (`only`) and works on that copy, so a field a format adds
 * tomorrow is dropped until someone decides to keep it. A few kept fields are
 * reduced on the way in, and the comment beside each says how: a URL keeps the
 * shape of its path and loses its host and query, an error is at most `true`.
 *
 * Never read, whatever the format: header values, cookies, request and
 * response bodies, user ids, query strings, hosts, statements, span names,
 * events, error and status messages, log lines, and a batch's objectives,
 * runtime and custom data.
 *
 * These lists say which fields of each record a reader looks at; what a span
 * may carry out of any reader is one list, `KEPT_FIELDS` in `span.ts`
 * (P105), which every reader's last call (`keepAllowed`) applies. OTLP
 * attributes off `OTLP_READS.attributes` are counted and skipped while they
 * are walked, in JSON (`otlpAttributes`) and in protobuf (`otlp-protobuf.ts`).
 */
export interface AllowList {
  readonly [record: string]: readonly string[];
}

export const OTLP_READS = {
  resource: ['attributes'],
  /** Of the resource's attributes. */
  resourceAttributes: ['service.name'],
  scopes: ['scopeSpans', 'instrumentationLibrarySpans'],
  scope: ['spans'],
  /** `status` is read for its code only: an error is `true`, its message is not read. */
  span: ['traceId', 'spanId', 'parentSpanId', 'kind', 'startTimeUnixNano', 'endTimeUnixNano', 'attributes', 'status'],
  spanStatus: ['code'],
  /** Of a span's attributes. A URL is reduced to the shape of its path. */
  attributes: [
    'http.request.method',
    'http.method',
    'http.route',
    'url.full',
    'http.url',
    'url.path',
    'http.target',
    'http.response.status_code',
    'http.status_code',
    'messaging.destination.name',
    'messaging.destination',
    'code.function.name',
    'code.function',
    'code.namespace',
    'db.collection.name',
    'db.mongodb.collection',
    'db.sql.table',
    'rpc.service',
    'rpc.method',
  ],
} as const satisfies AllowList;

/**
 * `@nestjs/observe` 0.3.x telemetry batches, as its wire contract names the
 * fields. Not read: `serviceVersion`, `logs`, `objectives`, `runtime`,
 * `custom` on a batch; `u` (user), `rq` (the request), `tg` on a snapshot;
 * `n`, `s`, `so` on a node; `db.statement` and every other tag.
 */
export const NESTJS_OBSERVE_READS = {
  batch: ['serviceId', 'snapshots', 'jobs'],
  /** `p` protocol, `op` operation, `a` the answer, `e` an error (read as `true`), `t` the span tree. */
  snapshot: ['ti', 'ct', 'd', 'p', 'op', 'a', 'e', 't'],
  /** `a.ou`, the original URL, is reduced to the shape of its path. */
  answer: ['m', 'sc', 'ou'],
  job: ['ti', 'ct', 'd', 'e', 't'],
  /** `o` origin, `c` class, `m` method key, `d` duration, `e` error (read as `true`), `t` tags, `ch` children. */
  node: ['o', 'c', 'm', 'd', 'e', 't', 'ch'],
  /** `http.url` is reduced to the shape of its path. */
  tags: ['http.method', 'http.url'],
} as const satisfies AllowList;

/** Every reader's list, by reader name. */
export const ALLOW_LISTS: Readonly<Record<string, AllowList>> = {
  otlp: OTLP_READS,
  'nestjs-observe': NESTJS_OBSERVE_READS,
};

type Json = Record<string, unknown>;

/** A copy of `value` holding only `fields`, or an empty record when it is not one. */
export const only = (value: unknown, fields: readonly string[]): Json => {
  const kept: Json = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return kept;
  for (const field of fields) {
    if (Object.hasOwn(value, field)) kept[field] = (value as Json)[field];
  }
  return kept;
};
