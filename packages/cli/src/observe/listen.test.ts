import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { request } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { observedPathFor, type GraphEdge, type GraphNode, type Observed, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILES, extraRequests, requestsFor, sendAll, SENDER_SECRET } from '../../../../scripts/observe-send.mjs';
import { runListen, runObserve } from '../commands/observe.js';
import { PLANTED } from './__fixtures__/planted.js';
import { parseInterval, parseSize, startListener, type Listener, type ListenOptions } from './listen.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../../../../fixtures');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-listen-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

type Graph = ProjectGraph & { nodes: GraphNode[]; edges: GraphEdge[] };
const graphOf = (name: string): { graph: Graph; report: LinkReport } => ({
  graph: JSON.parse(readFileSync(join(fixtures, name, 'expected.project-graph.json'), 'utf8')) as Graph,
  report: JSON.parse(readFileSync(join(fixtures, name, 'expected.link-report.json'), 'utf8')) as LinkReport,
});

let made = 0;
/** A graph database of its own in a directory of its own, so each case starts with no observed file. */
const freshDb = (name = 'multi-repo', empty = false): string => {
  made += 1;
  const dir = mkdtempSync(join(scratch, `case-${made}-`));
  const { graph, report } = graphOf(name);
  const db = join(dir, 'graph.db');
  writeGraphDb(empty ? { ...graph, nodes: [], edges: [] } : graph, report, db);
  return db;
};

const NOW = new Date('2025-10-16T09:00:00.000Z');
const open: Listener[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((listener) => listener.close()));
});

/** A listener on an ephemeral port of 127.0.0.1, closed after the case. */
const listen = async (db: string, options: Partial<ListenOptions> = {}): Promise<Listener> => {
  const listener = await startListener({
    db,
    port: 0,
    flushMs: 60_000,
    clock: () => NOW.getTime(),
    print: () => {},
    warn: () => {},
    ...options,
  });
  open.push(listener);
  return listener;
};

const withoutSources = (observed: Observed): Omit<Observed, 'sources'> => {
  const { sources: _sources, ...rest } = observed;
  return rest;
};

const fileOf = (db: string): Observed => JSON.parse(readFileSync(observedPathFor(db), 'utf8')) as Observed;

interface Raw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A request with exactly the headers given (Host included), to show what the listener refuses. */
const raw = (
  listener: Listener,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: Buffer | string; partial?: boolean },
): Promise<Raw> =>
  new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port: listener.address.port,
        method: options.method ?? 'POST',
        path: options.path ?? '/v1/traces',
        headers: { host: `127.0.0.1:${listener.address.port}`, ...options.headers },
        setHost: false,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    // A connection cut after the answer is what a refusal at the limit does; the answer is what is checked.
    sent.on('error', (cause: NodeJS.ErrnoException) => (cause.code === 'ECONNRESET' || cause.code === 'EPIPE' ? undefined : reject(cause)));
    if (options.body !== undefined) sent.write(options.body);
    if (options.partial !== true) sent.end();
  });

const JSON_TYPE = { 'content-type': 'application/json' };
const traceBody = JSON.stringify({ resourceSpans: [] });

describe('observe --listen gives the file a file run gives', () => {
  it('over the multi-repo traffic posted as JSON, protobuf and gzip, and @nestjs/observe batches', async () => {
    const byFiles = freshDb();
    runObserve(DEFAULT_FILES, { db: byFiles, now: NOW, print: () => {} });

    const db = freshDb();
    const printed: string[] = [];
    // What the process connects to while it listens: only the posts below, to its own port.
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const listener = await listen(db, { print: (line) => printed.push(line) });
    const requests = [...requestsFor(DEFAULT_FILES), ...extraRequests()];
    expect(new Set(requests.map((one) => one.label))).toEqual(
      new Set(['traces json', 'traces protobuf', 'traces gzip-json', 'batch', 'batch gzip', 'metrics json', 'logs protobuf']),
    );
    const answers = await sendAll(listener.address.url, requests);
    const stats = await listener.close();
    // `connect` is called with the normalised arguments, `[options, listener]`, or as written.
    const targets = connect.mock.calls.map((call) => {
      const first: unknown = Array.isArray(call[0]) ? call[0][0] : call[0];
      return typeof first === 'object' && first !== null ? (first as net.TcpNetConnectOpts).port : first;
    });
    connect.mockRestore();
    expect(new Set(targets)).toEqual(new Set([listener.address.port]));

    for (const answer of answers) {
      if (answer.path === '/applications/telemetry') expect(answer).toMatchObject({ status: 202 });
      else expect(answer.status).toBe(200);
    }
    // An empty ExportTraceServiceResponse in the request's own encoding.
    expect(answers.find((one) => one.label === 'traces json')!.body.toString()).toBe('{}');
    expect(answers.find((one) => one.label === 'traces protobuf')!.body.length).toBe(0);

    const listened = fileOf(db);
    expect(withoutSources(listened)).toEqual(withoutSources(fileOf(byFiles)));
    expect(listened.sources).toEqual([
      { sha256: expect.stringMatching(/^[0-9a-f]{64}$/), format: 'listen', spans: listened.spans, readAt: NOW.toISOString() },
    ]);
    expect(stats).toMatchObject({ posts: 7, spans: listened.sources[0]!.spans, metricPosts: 1, logPosts: 1, bad: 0, refused: 0, flushes: 1 });
    expect(stats.joins).toBe(Object.keys(listened.joins).length);
    expect(stats.unmatched).toBe(listened.unmatched.length);
    expect(printed).toEqual([`${stats.spans} spans, ${stats.joins} joins, ${stats.unmatched} unmatched since start; dropped: 1 metric post, 1 log post`]);

    // Exporters' credentials are never read, and nothing a reader drops is held.
    const text = readFileSync(observedPathFor(db), 'utf8');
    for (const secret of [SENDER_SECRET, ...PLANTED]) expect(text).not.toContain(secret);
    expect(JSON.stringify(stats)).not.toContain(SENDER_SECRET);
    expect(existsSync(join(dirname(db), 'observed.lock'))).toBe(false);
  });

  it('over the Lambda traffic, every encoding in turn', async () => {
    const adot = join(fixtures, 'lambda-traces/traces/adot.otlp.json');
    const byFiles = freshDb('lambda-traces');
    runObserve([adot], { db: byFiles, now: NOW, print: () => {} });
    const db = freshDb('lambda-traces');
    const listener = await listen(db);
    const requests = requestsFor([adot], { start: 1 });
    expect(new Set(requests.map((one) => one.label))).toEqual(
      new Set(['traces json', 'traces protobuf', 'traces gzip-json', 'traces gzip-protobuf']),
    );
    await sendAll(listener.address.url, requests);
    await listener.close();
    expect(withoutSources(fileOf(db))).toEqual(withoutSources(fileOf(byFiles)));
  });

  it('adds to a file a file run wrote, and a body equal to a file read before is not counted again', async () => {
    const checkout = DEFAULT_FILES[0]!;
    const db = freshDb();
    runObserve([checkout], { db, now: NOW, print: () => {} });
    const before = fileOf(db);
    const listener = await listen(db);
    const answer = await sendAll(listener.address.url, [
      { path: '/v1/traces', label: 'file', headers: JSON_TYPE, body: readFileSync(checkout) },
    ]);
    expect(answer[0]!.status).toBe(200);
    // Twice by the listener: once.
    const batch = requestsFor([DEFAULT_FILES[1]!]);
    await sendAll(listener.address.url, [...batch, ...batch]);
    const stats = await listener.close();
    expect(stats).toMatchObject({ repeated: 2, posts: 1 });
    const after = fileOf(db);
    expect(after.sources.map((source) => source.format)).toEqual(['otlp', 'listen']);
    const both = freshDb();
    runObserve([checkout, DEFAULT_FILES[1]!], { db: both, now: NOW, print: () => {} });
    expect(withoutSources(after)).toEqual(withoutSources(fileOf(both)));
    expect(after.spans).toBeGreaterThan(before.spans);
  });

  it('writes no trace id with --no-samples', async () => {
    const db = freshDb();
    const listener = await listen(db, { samples: false });
    await sendAll(listener.address.url, requestsFor(DEFAULT_FILES));
    await listener.close();
    const text = readFileSync(observedPathFor(db), 'utf8');
    expect(JSON.parse(text).samples).toEqual({});
    expect(text).not.toMatch(/(?<![0-9a-f])([0-9a-f]{32}|[0-9a-f]{16})(?![0-9a-f])/);
  });

  it('starts the file again with --reset, and cuts it to --since', async () => {
    const db = freshDb();
    runObserve([DEFAULT_FILES[2]!], { db, now: NOW, print: () => {} });
    const listener = await listen(db, { reset: true, since: '1h', clock: () => Date.parse('2025-10-16T09:30:00.000Z') });
    // The checkout's hour, 07:00, ended before 08:30; the series' 08:00 did not.
    await sendAll(listener.address.url, requestsFor([DEFAULT_FILES[0]!, DEFAULT_FILES[2]!]));
    await listener.close();
    const file = fileOf(db);
    expect(file.sources.map((source) => source.format)).toEqual(['listen']);
    expect(file.window.since).toBe('1h');
    expect(file.buckets.map((bucket) => bucket.hour)).toEqual(['2025-10-16T08:00:00.000Z']);
  });
});

describe('what the listener refuses', () => {
  it('a Host that is not its own loopback name: a rebound name cannot post', async () => {
    const listener = await listen(freshDb());
    const port = listener.address.port;
    for (const host of [`shop.example:${port}`, `127.0.0.1:${port + 1}`, `10.0.0.5:${port}`]) {
      const answer = await raw(listener, { headers: { ...JSON_TYPE, host }, body: traceBody });
      expect(answer.status).toBe(421);
    }
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `LOCALHOST:${port}`]) {
      expect((await raw(listener, { headers: { ...JSON_TYPE, host }, body: traceBody })).status).toBe(200);
    }
  });

  it('a request from a page: an Origin, OPTIONS, text/plain; and never a CORS header', async () => {
    const listener = await listen(freshDb());
    const fromPage = await raw(listener, { headers: { ...JSON_TYPE, origin: 'https://shop.example' }, body: traceBody });
    expect(fromPage.status).toBe(403);
    const preflight = await raw(listener, {
      method: 'OPTIONS',
      headers: { origin: 'https://shop.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(405);
    const simple = await raw(listener, { headers: { 'content-type': 'text/plain' }, body: traceBody });
    expect(simple.status).toBe(415);
    for (const answer of [fromPage, preflight, simple]) {
      expect(Object.keys(answer.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
    }
  });

  it('another path, another method, another encoding, a type a path does not take', async () => {
    const listener = await listen(freshDb());
    expect((await raw(listener, { path: '/v1/profiles', headers: JSON_TYPE, body: '{}' })).status).toBe(404);
    expect((await raw(listener, { method: 'GET' })).status).toBe(405);
    expect((await raw(listener, { method: 'PUT', headers: JSON_TYPE, body: '{}' })).status).toBe(405);
    expect((await raw(listener, { headers: { ...JSON_TYPE, 'content-encoding': 'br' }, body: traceBody })).status).toBe(415);
    const protobufBatch = await raw(listener, {
      path: '/applications/telemetry',
      headers: { 'content-type': 'application/x-protobuf' },
      body: Buffer.from([0x0a, 0x00]),
    });
    expect(protobufBatch.status).toBe(415);
    expect(listener.stats().refused).toBe(5);
  });

  it('a body over the limit, said or streamed, and one that inflates past it', async () => {
    const listener = await listen(freshDb(), { maxBody: 4 * 1024 });
    // Said too large: answered before the body is read.
    const said = await raw(listener, {
      headers: { ...JSON_TYPE, 'content-length': String(10 * 1024 * 1024) },
      body: Buffer.alloc(100, 0x20),
      partial: true,
    });
    expect(said.status).toBe(413);
    expect(said.headers['connection']).toBe('close');
    // Streamed past it, with no length said.
    const streamed = await raw(listener, {
      headers: { ...JSON_TYPE, 'transfer-encoding': 'chunked' },
      body: Buffer.alloc(5 * 1024, 0x20),
      partial: true,
    });
    expect(streamed.status).toBe(413);
    // A small gzip body that unpacks to a megabyte.
    const bomb = gzipSync(Buffer.from(`{"resourceSpans":[],"pad":"${' '.repeat(1024 * 1024)}"}`));
    expect(bomb.length).toBeLessThan(4 * 1024);
    const inflated = await raw(listener, { headers: { ...JSON_TYPE, 'content-encoding': 'gzip' }, body: bomb });
    expect(inflated.status).toBe(413);
    expect(listener.stats()).toMatchObject({ refused: 3, posts: 0 });
  });

  it('a body that does not decode: 400, nothing kept', async () => {
    const db = freshDb();
    const listener = await listen(db);
    const bad = [
      await raw(listener, { headers: { 'content-type': 'application/x-protobuf' }, body: Buffer.from([0x0a, 0x10, 0x01]) }),
      await raw(listener, { headers: JSON_TYPE, body: '{ "resourceSpans": [' }),
      await raw(listener, { headers: JSON_TYPE, body: '{ "something": "else" }' }),
      await raw(listener, { path: '/applications/telemetry', headers: JSON_TYPE, body: '{ "resourceSpans": [] }' }),
      await raw(listener, { headers: { ...JSON_TYPE, 'content-encoding': 'gzip' }, body: Buffer.from('not gzip') }),
    ];
    expect(bad.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 400]);
    expect(bad[0]!.body).toMatch(/not an OTLP trace request \(byte 2\)/);
    const stats = await listener.close();
    expect(stats).toMatchObject({ bad: 5, posts: 0, flushes: 0 });
    expect(existsSync(observedPathFor(db))).toBe(false);
  });

  it('metrics and logs: answered, read to the end, and nothing left behind', async () => {
    const db = freshDb();
    const listener = await listen(db);
    const answers = await sendAll(listener.address.url, extraRequests());
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const stats = await listener.close();
    expect(stats).toMatchObject({ metricPosts: 1, logPosts: 1, spans: 0, flushes: 0 });
    expect(existsSync(observedPathFor(db))).toBe(false);
  });
});

describe('where and how it runs', () => {
  it('binds loopback only, unless --host and --allow-remote are both given', async () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '::']) {
      await expect(listen(freshDb(), { host })).rejects.toThrow(new RegExp(`--host ${host.replace(/\./g, '\\.')} is not a loopback address`));
    }
    const listener = await listen(freshDb());
    expect(listener.address).toMatchObject({ host: '127.0.0.1', url: `http://127.0.0.1:${listener.address.port}` });
  });

  it('names --listen <port> when the port is taken', async () => {
    const first = await listen(freshDb());
    await expect(listen(freshDb(), { port: first.address.port })).rejects.toThrow(
      new RegExp(`port ${first.address.port} on 127\\.0\\.0\\.1 is in use; choose another with --listen <port>`),
    );
  });

  it('is the one writer: observe <files> says a listener is running, and so does a second listener', async () => {
    const db = freshDb();
    await listen(db);
    expect(() => runObserve([DEFAULT_FILES[0]!], { db, now: NOW, print: () => {}, lockWaitMs: 50 })).toThrow(/a listener is running/);
    await expect(listen(db, { lockWaitMs: 50 })).rejects.toThrow(/is held by process \d+: another listener/);
  });

  it('flushes on its timer, and reads the graph again when graph.db changes', async () => {
    const db = freshDb('multi-repo', true);
    const lines: string[] = [];
    const listener = await listen(db, { flushMs: 60_000, traceWaitMs: 0, print: (line) => lines.push(line) });
    await sendAll(listener.address.url, requestsFor([DEFAULT_FILES[1]!]));
    const blind = listener.flush()!;
    expect(Object.keys(blind.entries)).toEqual([]);
    expect(blind.unmatched.length).toBeGreaterThan(0);
    // The graph is built again underneath: the next posts are matched against it.
    const real = freshDb();
    copyFileSync(real, db);
    utimesSync(db, new Date(), new Date(Date.now() + 5_000));
    await sendAll(listener.address.url, requestsFor([DEFAULT_FILES[2]!]));
    const seen = listener.flush()!;
    expect(Object.keys(seen.entries).length).toBeGreaterThan(0);
    expect(lines).toHaveLength(2);
    expect(listener.flush()).toBeUndefined();
  });

  it('writes on the timer without being asked', async () => {
    const db = freshDb();
    const listener = await listen(db, { flushMs: 50, traceWaitMs: 0 });
    await sendAll(listener.address.url, requestsFor([DEFAULT_FILES[1]!]));
    await vi.waitFor(() => expect(existsSync(observedPathFor(db))).toBe(true), { timeout: 2_000, interval: 20 });
    expect(listener.stats().flushes).toBeGreaterThanOrEqual(1);
  });

  it('matches traces early when the buffer is full, and counts them', async () => {
    const db = freshDb();
    const listener = await listen(db, { maxTraces: 1 });
    await sendAll(listener.address.url, requestsFor([DEFAULT_FILES[0]!]));
    const stats = await listener.close();
    expect(stats.cutShort).toBeGreaterThan(0);
    expect(fileOf(db).spans).toBe(stats.spans);
  });

  it('runs from the command until told to stop, and says what it took', async () => {
    const db = freshDb();
    const printed: string[] = [];
    let stop!: () => void;
    const until = new Promise<void>((resolve) => (stop = resolve));
    const running = runListen({ db, listen: '0', print: (line) => printed.push(line), until, flush: '1m' });
    await vi.waitFor(() => expect(printed.length).toBe(1), { timeout: 2_000, interval: 10 });
    const url = /listening on (http:\/\/127\.0\.0\.1:\d+):/.exec(printed[0]!)![1]!;
    await sendAll(url, requestsFor([DEFAULT_FILES[1]!]));
    stop();
    const stats = await running;
    expect(stats.posts).toBe(1);
    expect(printed.at(-1)).toMatch(/^stopped: \d+ spans, \d+ joins?, \d+ unmatched since start$/);
    await expect(runListen({ db, listen: '0', format: 'json' })).rejects.toThrow(/--format applies to trace files, not to --listen/);
    await expect(runListen({ db, listen: 'x' })).rejects.toThrow(/--listen takes a port/);
    await expect(runListen({ db, listen: '0', flush: '10' })).rejects.toThrow(/--flush takes a duration/);
    await expect(runListen({ db, listen: '0', maxBody: 'big' })).rejects.toThrow(/--max-body takes a size/);
  });

  it('reads sizes and intervals as the flags say them', () => {
    expect(parseSize('8mb')).toBe(8 * 1024 * 1024);
    expect(parseSize('512KB')).toBe(512 * 1024);
    expect(parseSize('1048576')).toBe(1048576);
    expect(parseSize('0')).toBeUndefined();
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval('250ms')).toBe(250);
    expect(parseInterval('5m')).toBe(300_000);
    expect(parseInterval('soon')).toBeUndefined();
  });

  it('opens no connection and reads no header but its four: by its source', () => {
    for (const [file, headerReads] of [['listen.ts', 1], ['trace-buffer.ts', 0]] as const) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(source).not.toMatch(/node:https|node:dgram|node:tls|\bfetch\(|\.connect\(|createConnection|\brequest\(/);
      // Headers are read through `headerOf`, which takes the four names only, and Origin's presence.
      expect(source.match(/headers\[/g) ?? []).toHaveLength(headerReads);
    }
  });
});
