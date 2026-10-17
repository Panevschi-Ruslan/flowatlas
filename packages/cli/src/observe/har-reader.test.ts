import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type GraphEdge, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { settingsOfProject } from '../build/settings/index.js';
import { readTraceFiles, runObserve } from '../commands/observe.js';
import { frontEndContextOf } from './origins.js';
import { readerFor } from './readers.js';
import { harEntries, harReader } from './har-reader.js';
import { TraceFileError } from './reader-parts.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const harFile = join(fixture, 'traces/web.har');
const har = JSON.parse(readFileSync(harFile, 'utf8')) as { log: { entries: Record<string, unknown>[] } };
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const configPath = join(fixture, 'flowatlas.config.json');
const loaded = loadConfig(configPath);
const context = frontEndContextOf(graph.nodes, { config: loaded.config, settings: settingsOfProject(loaded) });
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-har-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/**
 * Everything planted in `web.har` that no output may hold (§4): a bearer
 * token, a session cookie and a refresh cookie, a token in a query, a password
 * and a card in request bodies, an email in response content, a JWT as a path
 * segment, a fragment, a page's title and body, a script's text, the server's
 * address, the connection, the initiator, the user agent, a traceparent, the
 * creator, the browser and a comment; our own hosts, an id in a path and the
 * third party's path and query.
 */
const HAR_PLANTED = [
  'har-bearer-k7',
  'Bearer',
  'har-sess-c9',
  'har-refresh-r4',
  'tok-q-31',
  'access_token',
  'hunter-pw-12',
  'password',
  '4111-har-card',
  'jane.doe@example.org',
  'eyJhbGciOiJIUzI1NiJ9',
  'har-frag-f3',
  'SPRING-77',
  'promo',
  'har-page-body',
  'har-script-s1',
  '203.0.113.9',
  '443-c12',
  'har-init-b5',
  'har-agent-u2',
  'har0trace0context',
  'WebInspector',
  'har-browser',
  'har-comment-x1',
  'gateway.example.test',
  'orders.example.test',
  'shop.example.test',
  'ord-5521',
  'v1/collect',
  'user-a-88',
];

const expectNoSecret = (text: string): void => {
  for (const secret of HAR_PLANTED) expect(text, secret).not.toContain(secret);
};

/** A HAR with these entries, every other part of it left out. */
const harOf = (...entries: unknown[]): unknown => ({ log: { version: '1.2', entries } });

describe('the HAR reader (P112)', () => {
  const read = harReader.read(har, undefined, { source: 'a'.repeat(64), frontEnd: () => context });

  it('recognises a HAR and nothing else', () => {
    expect(readerFor(har)).toBe(harReader);
    expect(readerFor({ log: { entries: [] } })).toBeUndefined();
    expect(readerFor({ log: { version: '1.2' } })).toBeUndefined();
  });

  it('keeps the calls a script made and counts the files it skipped', () => {
    expect(read.spans).toHaveLength(9);
    expect(read.skipped).toEqual([
      { noun: 'entry', why: 'of type document', count: 1 },
      { noun: 'entry', why: 'of type script', count: 1 },
      { noun: 'entry', why: 'of type image', count: 1 },
      { noun: 'entry', why: 'of a static file', count: 1 },
    ]);
  });

  it('reads each call as a client span of the front end: method, path shape, status, time, the service its origin names', () => {
    expect(read.spans[0]).toEqual({
      traceId: `har:${'a'.repeat(12)}:3`,
      spanId: `har:${'a'.repeat(12)}:3`,
      kind: 'client',
      service: 'web',
      method: 'GET',
      path: '/orders/:value',
      peerService: 'gateway',
      at: '2025-10-16T08:10:06.021Z',
      status: 200,
      durationMs: 84.25,
    });
    // No resource type: a JSON answer is a call.
    expect(read.spans[2]).toMatchObject({ method: 'POST', path: '/orders/:value/refund', peerService: 'gateway' });
    // Status 0: blocked or cancelled, an error with no status.
    expect(read.spans[3]).toMatchObject({ path: '/orders/:value/ship', error: true });
    expect(read.spans[3]).not.toHaveProperty('status');
    // A JWT as a path segment is a value.
    expect(read.spans[5]).toMatchObject({ path: '/orders/:value/receipt', status: 404 });
    expect(read.spans[6]).toMatchObject({ path: '/orders/:value', peerService: 'orders' });
  });

  it('names a third party by its host only: no path, no query', () => {
    const third = read.spans.find((span) => span.thirdParty !== undefined);
    expect(third).toEqual({
      traceId: `har:${'a'.repeat(12)}:10`,
      spanId: `har:${'a'.repeat(12)}:10`,
      kind: 'client',
      service: 'web',
      method: 'POST',
      thirdParty: 'analytics.example.net',
      at: '2025-10-16T08:10:20.070Z',
      status: 204,
      durationMs: 30,
    });
  });

  it('copies no planted secret into a span, and counts the keys it never read', () => {
    expectNoSecret(JSON.stringify(read));
    expect(read.droppedAttributes).toBeGreaterThan(100);
  });

  it('hands P113 the calls with method, path, status and time only', () => {
    const entries = harEntries(har);
    expect(entries.map((entry) => entry.index)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 12]);
    for (const entry of entries) {
      expect(Object.keys(entry).every((key) => ['index', 'method', 'path', 'status', 'error', 'durationMs', 'at'].includes(key))).toBe(true);
    }
    expectNoSecret(JSON.stringify(entries));
  });

  it('takes the front end from --service, else the map’s one front end, else refuses with the hint', () => {
    expect(harReader.read(har, 'shop', { frontEnd: () => context }).spans[0]).toMatchObject({ service: 'shop' });
    const two = { frontEnds: ['admin', 'web'], serviceAt: () => undefined };
    expect(() => harReader.read(har, undefined, { frontEnd: () => two })).toThrow(/2 \(admin, web\): name the one it was saved from with --service/);
    expect(() => harReader.read(har)).toThrow(/no front end to place them on: name it with --service/);
  });

  it('places a call on the front end’s own origin or a dev server by path, unnarrowed, and says when no base URL matched', () => {
    const { spans, notes } = harReader.read(
      harOf(
        { request: { method: 'GET', url: 'http://localhost:4200/api/cart' }, response: { status: 200 }, _resourceType: 'fetch' },
        { request: { method: 'GET', url: 'https://cdn.example.org/x' }, response: { status: 200 }, _resourceType: 'xhr' },
      ),
      'web',
    );
    expect(spans.map((span) => [span.path, span.peerService, span.thirdParty])).toEqual([
      ['/api/cart', undefined, undefined],
      [undefined, undefined, 'cdn.example.org'],
    ]);
    expect(notes).toBeUndefined();
    const none = harReader.read(harOf({ request: { method: 'GET', url: 'https://cdn.example.org/x' }, response: {}, _resourceType: 'xhr' }), 'web');
    expect(none.notes).toEqual([expect.stringMatching(/^no call in the HAR went to an origin a base URL of web names/)]);
  });

  it('tells a call from a file by MIME type and method when the browser wrote no resource type', () => {
    const { spans, skipped } = harReader.read(
      harOf(
        { request: { method: 'DELETE', url: 'https://gateway.example.test/orders/7' }, response: { status: 204, content: {} } },
        { request: { method: 'GET', url: 'https://gateway.example.test/feed' }, response: { status: 200, content: { mimeType: 'text/html' } } },
        { request: { method: 'GET', url: 'https://gateway.example.test/v' }, response: { status: 200, content: { mimeType: 'application/problem+json; charset=utf-8' } } },
        { request: { method: 'GET', url: 'data:image/png;base64,AAAA' }, response: {} },
      ),
      'web',
      { frontEnd: () => context },
    );
    expect(spans.map((span) => `${span.method} ${span.path}`)).toEqual(['DELETE /orders/:value', 'GET /v']);
    expect(skipped).toEqual([
      { noun: 'entry', why: 'of another type', count: 1 },
      { noun: 'entry', why: 'not over HTTP', count: 1 },
    ]);
  });

  it('refuses a malformed entry by index and field, quoting nothing of the file', () => {
    const cases: Array<[unknown, RegExp]> = [
      [harOf('har-bearer-k7'), /^HAR entry 0 is not an object$/],
      [harOf({ request: 'Bearer har-bearer-k7' }), /^HAR entry 0 has no request$/],
      [harOf({ request: { method: 'GET har-bearer-k7', url: 'https://x.example/' } }), /^HAR entry 0 has no request.method$/],
      [
        harOf({ request: { method: 'GET', url: 'https://x.example/a.png' } }, { request: { method: 'GET', url: 'not a url har-bearer-k7?tok-q-31' } }),
        /^HAR entry 1 has no absolute request.url$/,
      ],
    ];
    for (const [document, message] of cases) {
      let error: unknown;
      try {
        harReader.read(document, 'web');
      } catch (cause) {
        error = cause;
      }
      expect(error).toBeInstanceOf(TraceFileError);
      expect((error as Error).message).toMatch(message);
      expectNoSecret((error as Error).message);
    }
  });
});

describe('flowatlas observe over a HAR (P112)', () => {
  const dbPath = join(scratch, 'graph.db');
  const report = JSON.parse(readFileSync(join(fixture, 'expected.link-report.json'), 'utf8')) as LinkReport;
  writeGraphDb(graph, report, dbPath);
  const printed: string[] = [];
  const now = new Date('2025-10-16T09:00:00.000Z');
  const run = runObserve([harFile], { db: dbPath, config: configPath, now, print: (line) => printed.push(line) });
  const SITE = 'ui_api_call:web#src/app/orders-api.service.ts';

  it('counts the front end’s calls into the gateway on their ui_api_call joins, narrowed to the service the origin names', () => {
    expect(Object.fromEntries(Object.entries(run.observed.joins).map(([id, seen]) => [id, [seen.count, seen.errors, seen.measuredAt]]))).toEqual({
      [`${SITE}:106:12 -hits-> entry:gateway:http:POST:/orders/:param/resume`]: [1, 0, 'caller'],
      [`${SITE}:95:12 -hits-> entry:gateway:http:POST:/orders/:param/refund`]: [2, 0, 'caller'],
      [`${SITE}:95:12 -hits-> entry:gateway:http:POST:/orders/:param/ship`]: [1, 1, 'caller'],
    });
    // A call site the map draws no join for still ran; no back-end span, so no entry is hit and no sample kept.
    expect(Object.keys(run.observed.symbols).sort()).toEqual([`${SITE}:106:12`, `${SITE}:26:12`, `${SITE}:95:12`]);
    expect(run.observed.entries).toEqual({});
    expect(run.observed.samples).toEqual({});
  });

  it('counts a call that fits several call sites on none, and a third party by host', () => {
    expect(run.observed.ambiguous.map(({ name, candidates }) => [name, candidates.map((id) => id.slice(SITE.length + 1))])).toEqual([
      ['GET /orders/:value', ['21:12', '73:12']],
      ['GET /orders/:value', ['34:12', '48:12']],
      ['POST /orders/:value/invoice', ['123:3', '138:3', '61:12']],
    ]);
    expect(run.observed.unmatched.map(({ service, kind, name, count }) => ({ service, kind, name, count }))).toEqual([
      { service: 'web', kind: 'external', name: 'analytics.example.net', count: 1 },
    ]);
    expect(run.observed.sources).toEqual([expect.objectContaining({ format: 'har', spans: 9 })]);
  });

  it('lets no planted secret reach the observed file or the summary', () => {
    expectNoSecret(readFileSync(run.path, 'utf8'));
    expectNoSecret(printed.join('\n'));
    expect(printed).toContain('not read: 1 entry of type document, 1 entry of type script, 1 entry of type image, 1 entry of a static file');
  });

  it('refuses a malformed HAR by file, entry and field, and never quotes it', () => {
    const bad = join(scratch, 'bad.har');
    writeFileSync(bad, JSON.stringify(harOf({ request: { method: 'GET', url: 'Bearer har-bearer-k7 tok-q-31' } })));
    let message = '';
    try {
      readTraceFiles([bad], 'web');
    } catch (cause) {
      message = (cause as Error).message;
    }
    expect(message).toBe(`${bad}: HAR entry 0 has no absolute request.url`);
    expectNoSecret(message);
  });
});
