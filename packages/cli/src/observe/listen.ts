/**
 * `observe --listen`: a receiver on this machine (P109).
 *
 * An OpenTelemetry SDK and the @nestjs/observe agent both export over HTTP to
 * a URL they are given. Pointed here, what they post is read as `observe`
 * reads a file, through the same readers and the same allow-lists, matched
 * against the graph and merged into `.flowatlas/observed.json` on a timer and
 * on exit, with the merge a file run uses (D4): the same traffic gives the
 * same file either way.
 *
 * What makes it safe to leave running:
 *  - it binds loopback unless told `--host` and `--allow-remote` together;
 *  - a `Host` that is not this listener's loopback name is refused (421), so a
 *    page that rebinds a name to 127.0.0.1 cannot post; a request with an
 *    `Origin` is refused (403), `OPTIONS` is 405 and no CORS header is ever
 *    sent, so no page in a browser can make a request it could read or a
 *    non-simple one; `text/plain`, the content type a page may post without
 *    asking, is 415;
 *  - a body is limited before and after it is inflated, and the connection
 *    is cut at the limit;
 *  - of the request's headers only `host`, `content-type`, `content-encoding`
 *    and `content-length` are read, and whether an `Origin` is there: an
 *    exporter's credentials are never looked at;
 *  - inside the request the body is inflated, decoded and read, and the
 *    allow-list applied; only reduced spans (in a bounded `TraceBuffer`) and
 *    the aggregate outlive it;
 *  - metrics and logs are read to their end and dropped unparsed;
 *  - nothing is forwarded and no connection is opened: `node:http`'s server,
 *    nothing else of the network.
 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  describeObservedProblem,
  mergeObserved,
  observedFromParts,
  observedPathFor,
  parseDuration,
  type Observed,
  type ObservedSource,
} from '@flowatlas/core';
import { dbPathFor, openDbFromOptions, type DbOptions } from '../db.js';
import { cannotRun } from '../exit.js';
import { indexGraph, matchSpans, type GraphIndex } from './match.js';
import { decodeTraceRequest, ProtobufError } from './otlp-protobuf.js';
import { nestjsObserveReader, OTLP_KEEP, otlpReader, type SkippedPart, type TraceReader } from './readers/index.js';
import { keepAllowed, type ObservedSpan } from './span.js';
import { acquireObservedLock, ObservedLocked, readObservedBeside, saveObserved } from './store.js';
import { TraceBuffer } from './trace-buffer.js';

export const LISTEN_PORT = 4318;
export const LISTEN_HOST = '127.0.0.1';
export const LISTEN_FLUSH_MS = 30_000;
export const LISTEN_TRACE_WAIT_MS = 30_000;
export const LISTEN_MAX_BODY = 8 * 1024 * 1024;

/** The addresses a listener binds without `--allow-remote`. */
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

/** How many body hashes are remembered, so a body an exporter sends twice is read once. */
const KNOWN_BODIES = 50_000;

/** `30s`, `5m`, `250ms`, `1h` in milliseconds; nothing when it is not one. */
export const parseInterval = (text: string): number | undefined => {
  const said = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text.trim());
  if (said === null) return undefined;
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[said[2] as 'ms' | 's' | 'm' | 'h'];
  return Math.round(Number(said[1]) * unit);
};

/** `8mb`, `512kb`, `1048576` in bytes (1024 to a kilobyte); nothing when it is not one. */
export const parseSize = (text: string): number | undefined => {
  const said = /^(\d+)\s*(b|k|kb|m|mb|g|gb)?$/i.exec(text.trim());
  if (said === null) return undefined;
  const unit = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 }[
    (said[2] ?? 'b').toLowerCase() as 'b'
  ];
  const bytes = Number(said[1]) * unit;
  return bytes > 0 ? bytes : undefined;
};

export interface ListenOptions extends DbOptions {
  /** Address to bind (default `127.0.0.1`); anything not loopback needs `allowRemote` too. */
  host?: string;
  /** Port to bind (default 4318; 0 takes a free one). */
  port?: number;
  allowRemote?: boolean;
  /** How often the aggregate is merged into the file, in ms. */
  flushMs?: number;
  /** Largest body taken, in bytes, before and after inflating. */
  maxBody?: number;
  /** How long a trace waits for more spans after its last one, in ms. */
  traceWaitMs?: number;
  /** Bounds of the trace buffer (defaults `TRACE_BUFFER_SPANS`, `TRACE_BUFFER_TRACES`). */
  maxSpans?: number;
  maxTraces?: number;
  /** Service a span belongs to when the post does not say. */
  service?: string;
  /** As `observe --since`: the window cut at each flush. */
  since?: string;
  /** Start the file again at the first flush. */
  reset?: boolean;
  /** False: no sample is written, and the file's are removed. */
  samples?: boolean;
  /** No line per flush. */
  quiet?: boolean;
  print?: (line: string) => void;
  warn?: (line: string) => void;
  /** Milliseconds since the epoch; tests fix it. */
  clock?: () => number;
  /** How long to wait for the observed file's lock at start (default the store's). */
  lockWaitMs?: number;
}

/** What a listener has done since it started. */
export interface ListenStats {
  /** Trace and batch posts read. */
  posts: number;
  /** Spans read from them. */
  spans: number;
  /** Joins seen, and unmatched rows (service, kind, name), each counted once. */
  joins: number;
  unmatched: number;
  metricPosts: number;
  logPosts: number;
  /** Bodies already read, answered and not read again. */
  repeated: number;
  /** Posts that did not decode or were not the format their path takes (400). */
  bad: number;
  /** Requests refused before their body was read: host, origin, method, type, size. */
  refused: number;
  /** Traces matched before their wait was over because the buffer was full. */
  cutShort: number;
  flushes: number;
  /** What the readers saw and did not read, summed. */
  skipped: SkippedPart[];
}

export interface Listener {
  address: { host: string; port: number; url: string };
  /** The file beside the graph the listener writes. */
  path: string;
  stats(): ListenStats;
  /** Matches the traces whose wait is over and merges everything into the file now. */
  flush(): Observed | undefined;
  /** Stops taking requests, matches every trace held, writes the file, frees the lock. */
  close(): Promise<ListenStats>;
}

/** One line per flush. */
export const describeListenStats = (stats: ListenStats): string => {
  const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
  const parts = [`${plural(stats.spans, 'span')}, ${plural(stats.joins, 'join')}, ${stats.unmatched} unmatched since start`];
  if (stats.metricPosts + stats.logPosts > 0) {
    parts.push(`dropped: ${plural(stats.metricPosts, 'metric post')}, ${plural(stats.logPosts, 'log post')}`);
  }
  if (stats.cutShort > 0) parts.push(`${plural(stats.cutShort, 'trace')} cut short`);
  if (stats.repeated > 0) parts.push(`${plural(stats.repeated, 'post')} already read`);
  if (stats.bad > 0) parts.push(`${plural(stats.bad, 'post')} that did not decode`);
  if (stats.refused > 0) parts.push(`${plural(stats.refused, 'request')} refused`);
  return parts.join('; ');
};

// --- requests ------------------------------------------------------------------

/** The only request headers read (and whether an `Origin` is there at all). */
type ReadHeader = 'host' | 'content-type' | 'content-encoding' | 'content-length';

const headerOf = (request: IncomingMessage, name: ReadHeader): string | undefined => {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
};

type Encoding = 'json' | 'protobuf';

const MEDIA_TYPES: ReadonlyMap<string, Encoding> = new Map([
  ['application/json', 'json'],
  ['application/x-protobuf', 'protobuf'],
]);

interface Answer {
  status: number;
  type?: string;
  body?: string | Buffer;
}

/** OTLP/HTTP's success: an empty `Export*ServiceResponse` in the request's encoding. */
const exported = (encoding: Encoding): Answer =>
  encoding === 'json'
    ? { status: 200, type: 'application/json', body: '{}' }
    : { status: 200, type: 'application/x-protobuf', body: Buffer.alloc(0) };

/** A body that is not what its path takes: 400, nothing kept. */
class BadPost extends Error {}

/** One path the listener answers, as a Strategy: what it takes and what it does with a body. */
interface Route {
  types: ReadonlySet<Encoding>;
  take(body: Buffer, encoding: Encoding): Answer;
}

const sha256Of = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const jsonOf = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new BadPost('not JSON');
  }
};

/** Reads a body to its end, or stops at `limit` bytes and says so. */
const bodyOf = (request: IncomingMessage, limit: number): Promise<Buffer | 'too large'> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        request.off('data', onData);
        request.pause();
        resolve('too large');
        return;
      }
      chunks.push(chunk);
    };
    request.on('data', onData);
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
  });

/** `host:port` as a URL writes it. */
const hostPort = (host: string, port: number): string => `${host.includes(':') ? `[${host}]` : host}:${port}`;

const mtimeOf = (path: string): number | undefined => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
};

export const startListener = async (options: ListenOptions = {}): Promise<Listener> => {
  const host = options.host ?? LISTEN_HOST;
  const remote = !LOOPBACK.has(host);
  if (remote && options.allowRemote !== true) {
    throw cannotRun(
      `--host ${host} is not a loopback address; the listener takes posts from this machine only unless --allow-remote is given too`,
    );
  }
  const since = options.since;
  if (since !== undefined && since !== 'all' && parseDuration(since) === undefined) {
    throw cannotRun(`--since takes whole hours, days or weeks (2h, 24h, 7d, 2w) or all, not ${JSON.stringify(since)}`);
  }
  const clock = options.clock ?? Date.now;
  const print = options.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
  const maxBody = options.maxBody ?? LISTEN_MAX_BODY;
  const flushMs = options.flushMs ?? LISTEN_FLUSH_MS;
  const traceWaitMs = options.traceWaitMs ?? LISTEN_TRACE_WAIT_MS;
  const samples = options.samples !== false;
  const dbPath = dbPathFor(options);
  const path = observedPathFor(dbPath);

  // The graph, read once and again when graph.db changes.
  let index: GraphIndex;
  let indexedAt: number | undefined;
  const loadIndex = (): void => {
    const db = openDbFromOptions(options);
    try {
      index = indexGraph(db.allNodes(), db.allEdges());
    } finally {
      db.close();
    }
    indexedAt = mtimeOf(dbPath);
  };
  const currentIndex = (): GraphIndex => {
    const mtime = mtimeOf(dbPath);
    // A graph being rebuilt (no file for a moment) keeps the one read before.
    if (mtime !== undefined && mtime !== indexedAt) loadIndex();
    return index;
  };
  loadIndex();

  let release: () => void;
  try {
    release = acquireObservedLock(dirname(path), options.lockWaitMs === undefined ? {} : { waitMs: options.lockWaitMs });
  } catch (cause) {
    if (cause instanceof ObservedLocked) {
      throw cannotRun(`${cause.path} is held by process ${cause.pid}: another listener, or an observe run, is writing ${path}`);
    }
    throw cause;
  }

  const known = new Set<string>();
  const remember = (sha256: string): void => {
    known.add(sha256);
    if (known.size > KNOWN_BODIES) known.delete(known.values().next().value!);
  };
  try {
    const before = options.reset === true ? {} : readObservedBeside(dbPath);
    if (before.problem !== undefined) {
      throw cannotRun(`${describeObservedProblem(before.problem)}; run again with --reset to start a new one`);
    }
    // A body equal to a file read before is that file: not counted twice.
    for (const source of before.observed?.sources ?? []) remember(source.sha256);
  } catch (cause) {
    release();
    throw cause;
  }

  const stats: ListenStats = {
    posts: 0,
    spans: 0,
    joins: 0,
    unmatched: 0,
    metricPosts: 0,
    logPosts: 0,
    repeated: 0,
    bad: 0,
    refused: 0,
    cutShort: 0,
    flushes: 0,
    skipped: [],
  };
  const joinsSeen = new Set<string>();
  const unmatchedSeen = new Set<string>();
  const skipped = new Map<string, SkippedPart>();
  const buffer = new TraceBuffer({
    waitMs: traceWaitMs,
    ...(options.maxSpans === undefined ? {} : { maxSpans: options.maxSpans }),
    ...(options.maxTraces === undefined ? {} : { maxTraces: options.maxTraces }),
  });

  // What the next flush writes: matched traces, and the bodies first read since the last one.
  let pending: Observed | undefined;
  let bodies: string[] = [];
  let bodySpans = 0;
  let droppedAttributes = 0;
  let firstFlush = true;

  const match = (traces: ObservedSpan[][]): void => {
    if (traces.length === 0) return;
    const now = new Date(clock());
    const run = matchSpans(currentIndex(), traces.flat(), { now });
    pending = mergeObserved(pending, run, { now, ...(samples ? {} : { samples: false }) });
    for (const id of Object.keys(run.joins)) joinsSeen.add(id);
    for (const row of run.unmatched) unmatchedSeen.add(`${row.service ?? ''}\u0000${row.kind}\u0000${row.name}`);
    stats.joins = joinsSeen.size;
    stats.unmatched = unmatchedSeen.size;
  };

  /** A post read: its spans into the buffer, what its readers dropped counted. */
  const accept = (reader: TraceReader, document: unknown, sha256: string): void => {
    const read = reader.read(document, options.service, { part: stats.posts });
    stats.posts += 1;
    remember(sha256);
    bodies.push(sha256);
    bodySpans += read.spans.length;
    droppedAttributes += read.droppedAttributes;
    for (const part of read.skipped) {
      const key = `${part.noun}\u0000${part.why}`;
      const had = skipped.get(key);
      if (had === undefined) skipped.set(key, { ...part });
      else had.count += part.count;
    }
    // The readers end on `keepAllowed` already; once more here, so nothing else is held past the request.
    const spans = read.spans.map(keepAllowed);
    stats.spans += spans.length;
    const early = buffer.add(spans, clock());
    stats.cutShort = buffer.cutShort;
    match(early);
  };

  /** Whether a body was read before; when it was, it is answered and not read again. */
  const repeated = (sha256: string): boolean => {
    if (!known.has(sha256)) return false;
    stats.repeated += 1;
    return true;
  };

  const ROUTES: ReadonlyMap<string, Route> = new Map<string, Route>([
    [
      '/v1/traces',
      {
        types: new Set(['json', 'protobuf']),
        take: (body, encoding) => {
          const sha256 = sha256Of(body);
          if (repeated(sha256)) return exported(encoding);
          let document: unknown;
          if (encoding === 'protobuf') {
            try {
              document = decodeTraceRequest(body, OTLP_KEEP);
            } catch (cause) {
              if (cause instanceof ProtobufError) throw new BadPost(`not an OTLP trace request (byte ${cause.byte})`);
              throw cause;
            }
          } else {
            document = jsonOf(body);
            if (!otlpReader.sniff(document)) throw new BadPost('not an OTLP trace request: no resourceSpans');
          }
          accept(otlpReader, document, sha256);
          return exported(encoding);
        },
      },
    ],
    [
      '/v1/metrics',
      {
        types: new Set(['json', 'protobuf']),
        // Read to its end by the time it is here, and dropped unparsed.
        take: (_body, encoding) => {
          stats.metricPosts += 1;
          return exported(encoding);
        },
      },
    ],
    [
      '/v1/logs',
      {
        types: new Set(['json', 'protobuf']),
        take: (_body, encoding) => {
          stats.logPosts += 1;
          return exported(encoding);
        },
      },
    ],
    [
      '/applications/telemetry',
      {
        types: new Set(['json']),
        // The agent's own server answers 202 with no body (D5).
        take: (body) => {
          const sha256 = sha256Of(body);
          if (repeated(sha256)) return { status: 202 };
          const document = jsonOf(body);
          if (!nestjsObserveReader.sniff(document)) throw new BadPost('not a @nestjs/observe batch: no snapshots');
          accept(nestjsObserveReader, document, sha256);
          return { status: 202 };
        },
      },
    ],
  ]);

  const send = (response: ServerResponse, answer: Answer, headers: Record<string, string> = {}): void => {
    response.writeHead(answer.status, {
      ...(answer.type === undefined ? {} : { 'content-type': answer.type }),
      'content-length': String(answer.body === undefined ? 0 : Buffer.byteLength(answer.body)),
      ...headers,
    });
    response.end(answer.body);
  };

  const refuse = (response: ServerResponse, status: number, why: string, headers: Record<string, string> = {}): void => {
    stats.refused += 1;
    send(response, { status, type: 'text/plain; charset=utf-8', body: `${why}\n` }, headers);
  };

  /** Over the limit: answered, and the connection cut without reading the rest. */
  const tooLarge = (request: IncomingMessage, response: ServerResponse): void => {
    response.once('finish', () => request.socket.destroy());
    refuse(response, 413, `the body is over ${maxBody} bytes`, { connection: 'close' });
  };

  let allowedHosts: ReadonlySet<string> = new Set();
  let port = 0;
  const hostAllowed = (said: string | undefined): boolean => {
    if (said === undefined) return false;
    const named = said.trim().toLowerCase();
    if (allowedHosts.has(named)) return true;
    if (!remote) return false;
    // Bound elsewhere on purpose: an address written as numbers is never a name rebound to this machine.
    const parts = /^(?:\[([0-9a-f:.]+)\]|([0-9.]+)):(\d+)$/.exec(named);
    return parts !== null && Number(parts[3]) === port && isIP(parts[1] ?? parts[2] ?? '') !== 0;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!hostAllowed(headerOf(request, 'host'))) {
      return refuse(response, 421, `this listener answers to ${[...allowedHosts].join(', ')} only`);
    }
    const route = ROUTES.get((request.url ?? '').split('?')[0] ?? '');
    if (route === undefined) return refuse(response, 404, `not a path this listener takes: ${[...ROUTES.keys()].join(', ')}`);
    if (request.method !== 'POST') return refuse(response, 405, 'only POST is taken', { allow: 'POST' });
    // Only whether it is there: a page in a browser sends one, an exporter does not.
    if (Object.hasOwn(request.headers, 'origin')) return refuse(response, 403, 'a request from a page in a browser is not taken');
    const encoding = (headerOf(request, 'content-encoding') ?? 'identity').trim().toLowerCase();
    if (encoding !== 'identity' && encoding !== 'gzip') return refuse(response, 415, `content-encoding ${encoding} is not taken; gzip is`);
    const type = MEDIA_TYPES.get((headerOf(request, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase());
    if (type === undefined || !route.types.has(type)) {
      const takes = [...MEDIA_TYPES].filter(([, kind]) => route.types.has(kind)).map(([name]) => name);
      return refuse(response, 415, `content-type is not taken here; ${takes.join(' or ')} is`);
    }
    const length = Number(headerOf(request, 'content-length') ?? '0');
    if (length > maxBody) return tooLarge(request, response);
    let body: Buffer | 'too large';
    try {
      body = await bodyOf(request, maxBody);
    } catch {
      return;
    }
    if (body === 'too large') return tooLarge(request, response);
    if (encoding === 'gzip') {
      try {
        // Limited as it inflates: a small body cannot unpack past the limit.
        body = gunzipSync(body, { maxOutputLength: maxBody });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' || cause instanceof RangeError) {
          return tooLarge(request, response);
        }
        stats.bad += 1;
        return send(response, { status: 400, type: 'text/plain; charset=utf-8', body: 'gzip that cannot be unpacked\n' });
      }
    }
    try {
      send(response, route.take(body, type));
    } catch (cause) {
      if (!(cause instanceof BadPost)) throw cause;
      stats.bad += 1;
      send(response, { status: 400, type: 'text/plain; charset=utf-8', body: `${cause.message}\n` });
    }
  };

  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 60_000, headersTimeout: 15_000 }, (request, response) => {
    handle(request, response).catch((cause: unknown) => {
      warn(`observe --listen: ${cause instanceof Error ? cause.message : String(cause)}`);
      if (!response.headersSent) send(response, { status: 500 });
      else response.destroy();
    });
  });

  const flush = (final = false): Observed | undefined => {
    match(final ? buffer.drain() : buffer.expired(clock()));
    if (pending === undefined && bodies.length === 0) return undefined;
    const now = new Date(clock());
    // One source a flush, for the bodies first read in it, known by the hash of their hashes.
    const sources: ObservedSource[] =
      bodies.length === 0
        ? []
        : [{ sha256: sha256Of([...bodies].sort().join('\n')), format: 'listen', spans: bodySpans, readAt: now.toISOString() }];
    const reset = firstFlush && options.reset === true;
    const before = reset ? {} : readObservedBeside(dbPath);
    if (before.problem !== undefined) {
      warn(`${describeObservedProblem(before.problem)}; what was read is kept for the next flush`);
      return undefined;
    }
    const run = mergeObserved(
      pending,
      observedFromParts({ buckets: [], samples: {}, sources, droppedAttributes, samplesKept: samples }),
      { now, ...(samples ? {} : { samples: false }) },
    );
    const observed = mergeObserved(before.observed, run, {
      ...(since === undefined ? {} : { since }),
      ...(reset ? { reset: true } : {}),
      ...(samples ? {} : { samples: false }),
      now,
    });
    saveObserved(dbPath, observed);
    firstFlush = false;
    pending = undefined;
    bodies = [];
    bodySpans = 0;
    droppedAttributes = 0;
    stats.flushes += 1;
    if (options.quiet !== true) print(describeListenStats(snapshot()));
    return observed;
  };

  const snapshot = (): ListenStats => ({ ...stats, skipped: [...skipped.values()].map((part) => ({ ...part })) });

  const guarded = (fn: () => void) => (): void => {
    try {
      fn();
    } catch (cause) {
      warn(`observe --listen: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? LISTEN_PORT, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (cause) {
    release();
    const code = (cause as NodeJS.ErrnoException).code;
    const asked = options.port ?? LISTEN_PORT;
    if (code === 'EADDRINUSE') throw cannotRun(`port ${asked} on ${host} is in use; choose another with --listen <port>`);
    if (code === 'EACCES') throw cannotRun(`port ${asked} on ${host} needs privileges; choose another with --listen <port>`);
    throw cannotRun(`cannot listen on ${hostPort(host, asked)}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const bound = server.address();
  port = typeof bound === 'object' && bound !== null ? bound.port : (options.port ?? LISTEN_PORT);
  allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    ...(remote ? [hostPort(host, port).toLowerCase()] : []),
  ]);
  server.on('error', (cause) => warn(`observe --listen: ${cause.message}`));
  if (remote) {
    warn(
      `observe --listen: bound to ${hostPort(host, port)}, which other machines can reach (--allow-remote); ` +
        'nothing checks who posts and nothing is encrypted',
    );
  }

  const flushTimer = setInterval(guarded(() => flush()), flushMs);
  flushTimer.unref();
  // Traces whose wait is over are matched between flushes, so no trace id is held past it.
  const sweepTimer = setInterval(guarded(() => match(buffer.expired(clock()))), Math.max(10, Math.min(1_000, traceWaitMs)));
  sweepTimer.unref();

  let closing: Promise<ListenStats> | undefined;
  const close = (): Promise<ListenStats> =>
    (closing ??= (async () => {
      clearInterval(flushTimer);
      clearInterval(sweepTimer);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        // A sender still holding a connection open after a second is cut.
        setTimeout(() => server.closeAllConnections(), 1_000).unref();
      });
      try {
        flush(true);
      } finally {
        release();
      }
      return snapshot();
    })());

  return {
    address: { host, port, url: `http://${hostPort(host, port)}` },
    path,
    stats: snapshot,
    flush: () => flush(),
    close,
  };
};
