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
 * response bodies (except with `--shapes`, for their key names and JSON types
 * only, P113), user ids, query strings, hosts, statements, span names,
 * events, error and status messages, log lines, and a batch's objectives,
 * runtime and custom data; nor (P108) X-Ray annotations and metadata, a
 * workflow's input and output, client addresses, or request ids; and of a
 * browser's HAR file, every header, cookie, query string, request body and
 * response content (P112).
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
  resourceAttributes: ['service.name', 'faas.name', 'cloud.resource_id'],
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
    // The service a call went to, as its instrumentation names it (P146): a
    // name only, read through `peerNameOf` (an address is dropped, a value masked).
    'peer.service',
    // A deployed function or workflow and the cloud calls it makes (P107),
    // read in `aws.ts`. An ARN or a URL is cut to the name inside it there,
    // and no request parameter (`Key`, `Item`, `MessageBody`, `Input`) is read.
    'rpc.system',
    'messaging.system',
    'faas.name',
    'faas.trigger',
    'faas.invoked_name',
    'cloud.resource_id',
    'aws.lambda.invoked_arn',
    'aws.lambda.function.name',
    'aws.dynamodb.table_names',
    'aws.sqs.queue.url',
    'aws.sqs.queue_url',
    'aws.sns.topic.arn',
    'aws.sns.topic_arn',
    'aws.kinesis.stream_name',
    'aws.s3.bucket',
    'aws.eventbridge.bus_name',
    'aws.step_functions.state_machine.arn',
    'aws.step_functions.state.name',
  ],
  /**
   * The span attributes read as a list of names; every other attribute is a
   * single string or number, and a list under any other key is not read.
   */
  listAttributes: ['aws.dynamodb.table_names'],
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
  /**
   * Of a snapshot, only with `--shapes` (P113): the captured request, and of
   * it only `body`, walked for its shape (key names and JSON types) and
   * dropped. Never its `headers`. Version 0.3.x captures no response body.
   */
  shapesSnapshot: ['rq'],
  capturedRequest: ['body'],
} as const satisfies AllowList;

/**
 * Zipkin v2 JSON (P112), a list of spans or a list of traces. Tags go through
 * OTLP's key set (an OTel SDK's Zipkin exporter writes OTel keys) and Brave's
 * own `http.path`; `error` and `otel.status_code` are read as `true` only. Not
 * read: `name`, `annotations`, `remoteEndpoint`, `localEndpoint` beyond
 * `serviceName`, `debug`, `shared`, `sql.query` and every other tag.
 */
export const ZIPKIN_READS = {
  /** `timestamp` and `duration` are microseconds. */
  span: ['traceId', 'id', 'parentId', 'kind', 'timestamp', 'duration', 'localEndpoint', 'tags'],
  localEndpoint: ['serviceName'],
  /** Beside `OTLP_READS.attributes`. A URL or a path is reduced to the shape of its path. */
  tags: ['http.path', 'error', 'otel.status_code'],
} as const satisfies AllowList;

/**
 * A Jaeger trace as its UI's "Download JSON" and its query API write it
 * (P112): `{ data: [trace, ...] }`. Tags (`{ key, type, value }`) go through
 * OTLP's key set. Not read: `operationName`, `logs`, `warnings`, `flags`, a
 * process's `tags` (host name, IP, client version) and every other tag.
 */
export const JAEGER_READS = {
  document: ['data'],
  trace: ['traceID', 'spans', 'processes'],
  /** `startTime` and `duration` are microseconds; the parent is the first `CHILD_OF` reference. */
  span: ['traceID', 'spanID', 'references', 'startTime', 'duration', 'tags', 'processID'],
  reference: ['refType', 'spanID'],
  process: ['serviceName'],
  tag: ['key', 'value'],
  /** Beside `OTLP_READS.attributes`; `error` and `otel.status_code` are read as `true` only. */
  tags: ['span.kind', 'error', 'otel.status_code'],
} as const satisfies AllowList;

/**
 * A browser's HAR file (P112), the most sensitive file a user can hand over:
 * it holds their cookies, tokens and the body of every request. Each entry is
 * read for these fields by key and nothing else is ever a value the reader
 * holds (D2). `request.url` is reduced to the shape of its path, its origin
 * compared with the front end's base URLs and dropped; of `response.content`
 * only `mimeType`, to tell an API call from a file, when `_resourceType` is
 * not written. Never read: `request.headers`, `cookies`, `queryString`,
 * `postData` and `content.text` (except with `--shapes`, below),
 * `headersSize`, `bodySize`, `response.headers`, `cookies`, `redirectURL`, `serverIPAddress`, `connection`, `timings`,
 * `cache`, `pages`, `creator`, `browser`, `comment`, and every key starting
 * `_` other than `_resourceType`.
 */
export const HAR_READS = {
  document: ['log'],
  log: ['entries'],
  entry: ['startedDateTime', 'time', 'request', 'response', '_resourceType'],
  request: ['method', 'url'],
  response: ['status', 'content'],
  content: ['mimeType'],
  /**
   * Only with `--shapes` (P113), and only of a call kept as an API call: the
   * request's `postData` (its JSON `text`, or the `name` of each form field,
   * never a field's `value`) and the response content's `text` when its type
   * is JSON (base64-decoded when `encoding` says so). Each is parsed, walked
   * for its shape (key names and JSON types) and dropped in the same function.
   */
  shapesRequest: ['postData'],
  postData: ['mimeType', 'text', 'params'],
  param: ['name'],
  shapesContent: ['mimeType', 'text', 'encoding'],
} as const satisfies AllowList;

/**
 * X-Ray `batch-get-traces` output (P108). Each segment's `Document` is a JSON
 * string: it is parsed, read through these lists field by field, and dropped.
 * `name` is read as the service of a segment, the step of a state machine's
 * direct subsegment, and the AWS service of an SDK subsegment; never a
 * remote call's (it is a host). Not read: `annotations`, `metadata`, `sql`,
 * `user`, `cause`, `service`, `precursor_ids`, `aws.request_id`,
 * `aws.account_id`, `aws.region`, `aws.xray`, `http.request.client_ip`,
 * `user_agent`, `x_forwarded_for`, and every other field.
 */
export const XRAY_READS = {
  output: ['Traces'],
  trace: ['Segments'],
  segment: ['Document'],
  /** `fault` is read as an error; `error` (a 4xx) is not, its status is. */
  document: [
    'id',
    'trace_id',
    'parent_id',
    'type',
    'name',
    'origin',
    'namespace',
    'inferred',
    'start_time',
    'end_time',
    'fault',
    'http',
    'aws',
    'resource_arn',
    'subsegments',
  ],
  http: ['request', 'response'],
  /** `url` is reduced to the shape of its path. */
  request: ['method', 'url'],
  response: ['status'],
  /** Each an ARN, a URL or a name, cut to the deployed name inside it in `aws.ts`. */
  aws: [
    'operation',
    'function_arn',
    'function_name',
    'table_name',
    'resource_names',
    'queue_url',
    'topic_arn',
    'state_machine_arn',
    'bucket_name',
    'stream_name',
  ],
} as const satisfies AllowList;

/**
 * Step Functions `get-execution-history` output, with `describe-execution`'s
 * names merged in when the user did (P108). Not read: every `input`,
 * `output`, `inputDetails`, `outputDetails`, `parameters`, `cause` and
 * `error`, `roleArn`, `taskToken`, and every other detail: a failure is the
 * event's type, not its text.
 */
export const SFN_HISTORY_READS = {
  execution: ['events', 'executionArn', 'stateMachineArn', 'name'],
  event: [
    'id',
    'previousEventId',
    'type',
    'timestamp',
    'executionStartedEventDetails',
    'stateEnteredEventDetails',
    'stateExitedEventDetails',
    'lambdaFunctionScheduledEventDetails',
    'taskScheduledEventDetails',
  ],
  executionStarted: ['stateMachineAliasArn', 'stateMachineVersionArn'],
  stateEntered: ['name'],
  stateExited: ['name'],
  /** A function's ARN, cut to its name. */
  lambdaScheduled: ['resource'],
  /** `lambda` and `invoke`, `dynamodb` and `updateItem.sync`: cut to the operation. */
  taskScheduled: ['resourceType', 'resource'],
} as const satisfies AllowList;

/**
 * An API Gateway access log line, by the names the API Gateway docs' JSON
 * examples use, matched without regard to case, plus whatever
 * `--access-log-keys` names (P108 D4). Not read: `ip`, `sourceIp`,
 * `userAgent`, `caller`, `user`, `identity.*`, `authorizer.*`, `requestId`,
 * `extendedRequestId`, `domainName`, and any key not named here.
 */
export const APIGW_ACCESS_LOG_READS = {
  /** `path` is reduced to the shape of its path. */
  line: [
    'routeKey',
    'httpMethod',
    'resourcePath',
    'path',
    'status',
    'responseLatency',
    'latency',
    'integrationLatency',
    'requestTimeEpoch',
    'requestTime',
    'integrationStatus',
  ],
  /** A CloudWatch Logs export the lines come in: the message (parsed, read, dropped) and its time. */
  record: ['@message', '@timestamp', 'message', 'timestamp'],
} as const satisfies AllowList;

/**
 * Lambda `REPORT` lines from a CloudWatch Logs export (P108). Of a line, only
 * `Duration` and `Status` are read; not `RequestId`, `Billed Duration`,
 * `Memory Size`, `Max Memory Used`, `Init Duration`, the X-Ray ids on the
 * line, nor any line that is not a `REPORT` line.
 */
export const LAMBDA_REPORT_READS = {
  /** `@log` and `@logStream` are read for the function's name only, cut from the log group. */
  record: ['@message', '@timestamp', '@log', '@logStream', '@duration', 'message', 'timestamp'],
  line: ['Duration', 'Status'],
} as const satisfies AllowList;

/** Every reader's list, by reader name. */
export const ALLOW_LISTS: Readonly<Record<string, AllowList>> = {
  otlp: OTLP_READS,
  'nestjs-observe': NESTJS_OBSERVE_READS,
  zipkin: ZIPKIN_READS,
  jaeger: JAEGER_READS,
  har: HAR_READS,
  xray: XRAY_READS,
  'sfn-history': SFN_HISTORY_READS,
  'apigw-access-log': APIGW_ACCESS_LOG_READS,
  'lambda-report': LAMBDA_REPORT_READS,
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
