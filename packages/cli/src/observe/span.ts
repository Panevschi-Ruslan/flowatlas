/**
 * One span from a trace file, reduced to what can name a place in the code.
 *
 * Readers build these and nothing else leaves a reader: header values, query
 * strings, hosts, ids in a path, user ids, message bodies, error messages and
 * database statements are never copied in (each reader's allow-list is in
 * `allow-list.ts`). A path keeps its shape and loses its query; a template
 * keeps its parameters by name only.
 */
import { isValueKey, OBSERVED_KEPT } from '@flowatlas/core';

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
  /** HTTP status answered, when the file says (P85, P105). Kept, not matched on. */
  status?: number;
  /** How long the span took, in milliseconds to two decimals (P85, P105). Kept, not matched on. */
  durationMs?: number;
  /** The span ended in an error. Never the error itself: no message, no stack. */
  error?: true;
  // A deployed function, workflow and the cloud calls they make (P107). Every
  // one is the name a thing is deployed under: an ARN or a URL is cut to the
  // name inside it before the span exists, so no account or region is held.
  /** The function the span ran in, as it is deployed (`checkout`; an alias or a version cut). */
  faas?: string;
  /** What started the function: `http`, `pubsub`, `datasource`, `timer` or `other`. */
  trigger?: FaasTrigger;
  /** The function an SDK `Invoke` call invokes. */
  invokes?: string;
  /** The workflow the span ran in, or the one an SDK call starts. */
  workflow?: string;
  /** The step of `workflow` the span is; matched only against the steps the map has. */
  state?: string;
  /** The tables a DynamoDB call names, each by its name. */
  tables?: string[];
  /** The operation of a cloud SDK call: `PutItem`, `SendMessage`, `StartExecution`. */
  awsOp?: string;
  /** Which service's channels `destination` is spelled for (`sqs/<name>`, `sns/<name>`, ...). */
  transport?: AwsTransport;
  // Where a browser call went (P112). The origin it was sent to is compared
  // with the front end's base URLs inside the reader and never kept.
  /** The service the call's origin names; the call is matched to a join into that service. */
  peerService?: string;
  /** The host of a third party the call went to, when no base URL names its origin; such a call has no path. */
  thirdParty?: string;
  /**
   * `false` on a span from a source with no tree (an access log line, a
   * REPORT line, P108): it is counted on its entry and never made a sample,
   * since a sample of one span with an id made up for it says nothing.
   */
  sampleable?: false;
}

export type FaasTrigger = 'http' | 'pubsub' | 'datasource' | 'timer' | 'other';

export type AwsTransport = 'sqs' | 'sns' | 'eventbridge' | 'kinesis' | 's3' | 'dynamodb';

/**
 * Every field a span may carry out of a reader (P105 §4), the list the
 * observed file's `privacy.kept` names. Typed against `ObservedSpan`, so a
 * field added to one and not the other does not compile.
 */
export const KEPT_FIELDS: readonly (keyof ObservedSpan)[] = OBSERVED_KEPT;

/** And the other way round: a field of `ObservedSpan` missing from the list does not compile either. */
type Unlisted = Exclude<keyof ObservedSpan, (typeof OBSERVED_KEPT)[number]>;
const everyFieldListed: [Unlisted] extends [never] ? true : Unlisted = true;
void everyFieldListed;

const KEPT: ReadonlySet<string> = new Set(KEPT_FIELDS);

/**
 * The span with only `KEPT_FIELDS`, none of them undefined: the last call
 * every reader makes, so whatever a reader is changed to build, nothing else
 * leaves it.
 */
export const keepAllowed = (span: ObservedSpan): ObservedSpan => {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(span)) if (KEPT.has(key) && value !== undefined) kept[key] = value;
  return kept as unknown as ObservedSpan;
};

/** What a path segment that holds a value is replaced with; it matches only a route parameter. */
export const VALUE = ':value';

/**
 * A segment, or a body's key (P113), that carries a value rather than a name:
 * any digit, a long token, an email, a UUID or a hex token. One rule for both
 * (P113 D2), kept in core beside the shape it also folds.
 */
export { isValueKey };

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
    .map((segment) => (segment !== '' && isValueKey(segment) ? VALUE : segment))
    .join('/');
};
