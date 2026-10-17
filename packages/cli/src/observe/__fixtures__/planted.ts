/**
 * Values planted in `fixtures/multi-repo/traces/` that no reader may copy into
 * a span, the observed file, the page or an MCP answer (P85): a bearer token,
 * a user id, ids and query strings in URLs, hosts, a database statement, tags,
 * an error message, a log line and a batch's version, objectives, runtime and
 * custom data; and (P105) a cookie, a statement, a span name holding an id, a
 * status message and an exception's text.
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
];

