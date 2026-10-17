/**
 * Values planted in `fixtures/multi-repo/traces/` that no reader may copy into
 * a span, the observed file, the page or an MCP answer (P85): a bearer token,
 * a user id, ids and query strings in URLs, hosts, a database statement, tags,
 * an error message, a log line and a batch's version, objectives, runtime and
 * custom data; and (P105) a cookie, a statement, a span name holding an id, a
 * status message and an exception's text; and (P113) a field a captured
 * request carries, by name and value, which only `--shapes` may read the name of.
 */
export const PLANTED = [
  'not-a-real-token',
  'user-7781',
  's3cr3t',
  'session',
  'ord-1042',
  'ord-1043',
  'ord-2001',
  'cus-311',
  'inv-9001',
  '_id',
  'insert',
  'orders.internal',
  'orders.local',
  'gateway.local',
  'expand',
  'lb-7',
  'tenant-tag-9',
  '1.4.2-build.77',
  'objective-p99',
  'billing-host-3',
  'custom-value-17',
  'timeout from',
  'stack',
  'post to ledger',
  'failed for customer',
  'cookie-val-55',
  'secret-stmt-8',
  'duplicate key',
  'memo-val-61',
  'memo',
];


/**
 * Every value planted in the bodies of `fixtures/multi-repo/traces/` (P113):
 * the @nestjs/observe captured requests and the HAR's request bodies and
 * response content, values of every JSON type and keys that are values (an
 * order id, an email, a token). `observe --shapes` keeps key names and JSON
 * types only, so none of these may reach a shape, the observed file, the
 * summary, the contracts report or an MCP answer.
 */
export const BODY_VALUES = [
  'ord-1043',
  'memo-val-61',
  'not-a-real-token',
  'cookie-val-55',
  'hunter-pw-12',
  '4111-har-card',
  'jane.doe@example.org',
  'ord-5521',
  'cus-har-2',
  'har-gift-g6',
  'har-state-s8',
  'tok-q-31',
  '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  '42.5',
  'EUR',
  'paid',
];
