import { APIGW_ACCESS_LOG_READS } from '../allow-list.js';
import { pathOf, type ObservedSpan } from '../span.js';
import { logRecordsOf, recordMs } from './log-records.js';
import {
  Dropped,
  isObject,
  isoOfMs,
  ms2,
  numberOf,
  Skips,
  statusOf,
  text,
  withFields,
  type AccessLogKeys,
  type AccessLogRole,
  type Json,
  type ReaderOptions,
  type TraceReader,
} from './shared.js';

/**
 * API Gateway access logs in JSON (P108): one request a line, as JSON lines,
 * or the messages of a CloudWatch Logs export (`log-records.ts`). Each line
 * is a request through a route: its method and template, its status, how
 * long it took and when. Lines have no parent and no trace, so they give
 * entries, never joins, and no sample (D3).
 *
 * The keys are those the API Gateway docs' JSON examples use, matched without
 * regard to case, with `--access-log-keys` for a format a team named
 * otherwise (D4): a mapping cannot misread an address as a route, a heuristic
 * could. Every other key is counted and never looked at.
 */

/** The keys each role is read from, in order, after a key `--access-log-keys` names for it. */
const ROLE_KEYS: Readonly<Record<AccessLogRole, readonly string[]>> = {
  // `POST /checkout` (an HTTP API's route key) or `/orders/{id}` (a REST API's resource path).
  route: ['routeKey', 'resourcePath'],
  method: ['httpMethod'],
  path: ['path'],
  status: ['status'],
  latency: ['responseLatency', 'latency', 'integrationLatency'],
  time: ['requestTimeEpoch', 'requestTime'],
};

const INTEGRATION_STATUS = 'integrationStatus';

/** A line's keys, lower-cased, to the value under each; only the keys asked for are looked up. */
type Line = ReadonlyMap<string, unknown>;

const lineOf = (value: Json): Line => new Map(Object.entries(value).map(([key, field]) => [key.toLowerCase(), field]));

/** The keys a line may be read under: the documented names and the mapped ones, lower-cased. */
const readable = (keys: AccessLogKeys | undefined): ReadonlySet<string> =>
  new Set([...Object.values(ROLE_KEYS).flat(), INTEGRATION_STATUS, ...Object.values(keys ?? {})].map((key) => key.toLowerCase()));

const valueOf = (line: Line, role: AccessLogRole, keys: AccessLogKeys | undefined): unknown => {
  for (const key of [...(keys?.[role] === undefined ? [] : [keys[role]!]), ...ROLE_KEYS[role]]) {
    const value = line.get(key.toLowerCase());
    if (value !== undefined && value !== null && value !== '' && value !== '-') return value;
  }
  return undefined;
};

/** A request through a route, a status beside it: an access log line. */
const isLine = (value: unknown, keys: AccessLogKeys | undefined): value is Json => {
  if (!isObject(value)) return false;
  const line = lineOf(value);
  const has = (role: AccessLogRole): boolean => valueOf(line, role, keys) !== undefined;
  return has('status') && (has('route') || (has('method') && has('path')));
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `$context.requestTime`: `16/Oct/2025:08:30:00 +0000`. */
const CLF_TIME = /^(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

/** `$context.requestTimeEpoch` (milliseconds; seconds read too), or `$context.requestTime`. */
const timeOf = (value: unknown): number | undefined => {
  const epoch = numberOf(value);
  if (epoch !== undefined) return epoch < 1e11 ? epoch * 1000 : epoch;
  const clf = typeof value === 'string' ? CLF_TIME.exec(value.trim()) : null;
  if (clf === null) return recordMs(value);
  const [, day, month, year, hour, minute, second, sign, zoneHours, zoneMinutes] = clf;
  const index = MONTHS.indexOf(month!);
  if (index < 0) return undefined;
  const offset = (sign === '-' ? -1 : 1) * (Number(zoneHours) * 60 + Number(zoneMinutes)) * 60_000;
  return Date.UTC(Number(year), index, Number(day), Number(hour), Number(minute), Number(second)) - offset;
};

const METHOD_AND_ROUTE = /^([A-Z]+)\s+(\/\S*)$/;

/** The method and template a route key or resource path says; `$default` says neither. */
const routeOf = (value: unknown, method: string | undefined): { method?: string; route?: string } => {
  const said = text(typeof value === 'string' ? value.trim() : undefined);
  if (said === undefined || said.startsWith('$')) return method === undefined ? {} : { method };
  const paired = METHOD_AND_ROUTE.exec(said);
  if (paired !== null) return { method: paired[1] === 'ANY' ? method : paired[1], route: paired[2] };
  return said.startsWith('/') ? { ...(method === undefined ? {} : { method }), route: said } : method === undefined ? {} : { method };
};

/** One access log line as a server span, from the keys its roles name and nothing else. */
const lineSpan = (value: Json, id: string, service: string | undefined, keys: AccessLogKeys | undefined, dropped: Dropped, fallbackMs?: number): ObservedSpan => {
  const line = lineOf(value);
  const allowed = readable(keys);
  for (const key of line.keys()) if (!allowed.has(key)) dropped.count += 1;
  const method = text(valueOf(line, 'method', keys))?.toUpperCase();
  const routed = routeOf(valueOf(line, 'route', keys), method);
  const path = text(valueOf(line, 'path', keys));
  const latency = numberOf(valueOf(line, 'latency', keys));
  const integration = statusOf(line.get(INTEGRATION_STATUS.toLowerCase()));
  return withFields(
    { traceId: id, spanId: id, kind: 'server' },
    {
      service,
      method: routed.method,
      route: routed.route,
      path: routed.route === undefined && path !== undefined ? pathOf(path) : undefined,
      status: statusOf(valueOf(line, 'status', keys)),
      durationMs: latency === undefined ? undefined : ms2(latency),
      at: isoOfMs(timeOf(valueOf(line, 'time', keys)) ?? fallbackMs),
      error: integration !== undefined && integration >= 500 ? true : undefined,
      sampleable: false,
    },
  );
};

/** A log message parsed to the object it holds, read once and dropped. */
const parsed = (message: string | undefined): unknown => {
  if (message === undefined || !message.trimStart().startsWith('{')) return undefined;
  try {
    return JSON.parse(message) as unknown;
  } catch {
    return undefined;
  }
};

/** How many records of an export are looked at to decide it holds access log lines. */
const SNIFFED = 20;

export const apigwAccessLogReader: TraceReader = {
  name: 'apigw-access-log',
  takes: ['accessLogKeys'],
  sniff: (document, options: ReaderOptions = {}) => {
    if (isLine(document, options.accessLogKeys)) return true;
    const records = logRecordsOf(document, APIGW_ACCESS_LOG_READS.record);
    return records?.slice(0, SNIFFED).some((record) => isLine(parsed(record.message), options.accessLogKeys)) ?? false;
  },
  read: (document, fallbackService, options = {}) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const part = options.part ?? 0;
    const keys = options.accessLogKeys;
    if (isLine(document, keys)) {
      return { spans: [lineSpan(document, `apigw:${part}`, fallbackService, keys, dropped)], skipped: [], droppedAttributes: dropped.count };
    }
    const spans: ObservedSpan[] = [];
    (logRecordsOf(document, APIGW_ACCESS_LOG_READS.record, dropped) ?? []).forEach((record, index) => {
      const line = parsed(record.message);
      if (isLine(line, keys)) spans.push(lineSpan(line, `apigw:${part}:${index}`, fallbackService, keys, dropped, recordMs(record.timestamp)));
      else skips.add('line', 'not holding an access log line');
    });
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};
