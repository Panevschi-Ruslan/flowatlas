import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type GraphEdge, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { BODY_VALUES } from '../__fixtures__/planted.js';
import { settingsOfProject } from '../../build/settings/index.js';
import { readTraceFiles, runObserve } from '../../commands/observe.js';
import { frontEndContextOf } from '../origins.js';
import { readerFor } from './index.js';
import { harEntries, harReader } from './har.js';
import { TraceFileError } from './shared.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/multi-repo');
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
  // Bodies (P113): read for their shape only with --shapes, and not at all without.
  'cus-har-2',
  'har-gift-g6',
  'har-state-s8',
  'giftNote',
];

/** With `--shapes` key names are kept; every value, and every key that is a value, is still never kept (P113). */
const KEY_NAMES = new Set(['password', 'giftNote']);
const expectNoValue = (text: string): void => {
  for (const secret of [...HAR_PLANTED.filter((one) => !KEY_NAMES.has(one)), ...BODY_VALUES]) expect(text, secret).not.toContain(secret);
};

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
      sampleable: false,
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
      sampleable: false,
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

  it('reads no body and says so: the file holds no shape, its privacy block says bodies were not read', () => {
    expect(run.observed.privacy.bodies).toBe('not read');
    expect(run.observed).not.toHaveProperty('shapes');
    expect(run.traffic).toBeUndefined();
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

/** A HAR call whose body and content throw when read: nothing may touch them without --shapes (P113). */
const trapped = (): unknown => {
  const request: Record<string, unknown> = { method: 'POST', url: 'https://gateway.example.test/orders/7/invoice' };
  Object.defineProperty(request, 'postData', { enumerable: true, get: () => { throw new Error('postData was read'); } });
  const content: Record<string, unknown> = { mimeType: 'application/json' };
  Object.defineProperty(content, 'text', { enumerable: true, get: () => { throw new Error('content.text was read'); } });
  return harOf({ startedDateTime: '2025-10-16T08:00:00.000Z', time: 3, _resourceType: 'fetch', request, response: { status: 201, content } });
};

describe('the HAR reader with --shapes (P113)', () => {
  it('never touches a body without --shapes, and reads it only with', () => {
    expect(() => harReader.read(trapped(), 'web')).not.toThrow();
    expect(() => harEntries(trapped())).not.toThrow();
    expect(() => harReader.read(trapped(), 'web', { shapes: true })).toThrow('postData was read');
  });

  it('keeps each API call’s body as key names and JSON types, base64 decoded, value-like keys folded', () => {
    const entries = harEntries(har, { shapes: true });
    const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
    expect(Object.keys(byIndex.get(12)!.request!.f!)).toEqual(['customerId', 'giftNote', 'id', 'total']);
    expect(byIndex.get(3)!.response!.f!['history']!.s).toEqual({
      t: 'object',
      n: 1,
      idx: {
        t: 'object',
        n: 1,
        f: { by: { s: { t: 'string', n: 1 }, n: 1, opt: true }, state: { s: { t: 'string', n: 1 }, n: 1 } },
      },
    });
    // Saved as base64 by the browser, read as the JSON it encodes.
    expect(Object.keys(byIndex.get(9)!.response!.f!)).toEqual(['customerId', 'id', 'status', 'total']);
    expectNoValue(JSON.stringify(entries));
  });

  it('reads a form’s field names only and counts a body that is not JSON', () => {
    const form = harOf({
      _resourceType: 'fetch',
      request: {
        method: 'POST',
        url: 'http://localhost:3000/orders',
        postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'customerId', value: 'cus-har-2' }, { name: 'ord-5521', value: 'x' }] },
      },
      response: { status: 200, content: { mimeType: 'application/json', text: 'not json at all' } },
    });
    const read = harReader.read(form, 'web', { shapes: true });
    expect(read.bodies).toEqual([
      {
        traceId: 'har:file:0',
        spanId: 'har:file:0',
        request: { t: 'object', n: 1, f: { customerId: { s: { t: 'string', n: 1 }, n: 1 } }, idx: { t: 'string', n: 1 } },
      },
    ]);
    expect(read.skipped).toEqual([{ noun: 'body', why: 'not JSON', count: 1 }]);
    expectNoValue(JSON.stringify(read));
  });
});

describe('flowatlas observe --shapes over a HAR (P113)', () => {
  const dir = join(scratch, 'shapes');
  mkdirSync(dir);
  const dbPath = join(dir, 'graph.db');
  writeGraphDb(graph, JSON.parse(readFileSync(join(fixture, 'expected.link-report.json'), 'utf8')) as LinkReport, dbPath);
  const printed: string[] = [];
  const now = new Date('2025-10-16T09:00:00.000Z');
  const run = runObserve([harFile], { db: dbPath, config: configPath, now, shapes: true, print: (line) => printed.push(line) });

  it('keeps the shapes per route and says bodies were read for shape only', () => {
    expect(run.observed.privacy.bodies).toBe('read for shape only');
    expect(Object.keys(run.observed.shapes ?? {})).toEqual([
      'entry:gateway:http:GET:/orders/:param',
      'entry:gateway:http:POST:/orders/:param/invoice',
      'entry:gateway:http:POST:/orders/:param/refund',
      'entry:gateway:http:POST:/orders/:param/resume',
      'entry:gateway:http:POST:/orders/:param/ship',
      'entry:orders:http:GET:/orders/:param',
    ]);
    // Cut and merged by the hour like the counts.
    expect(run.observed.buckets.some((bucket) => bucket.shapes !== undefined)).toBe(true);
    expect(run.bodies).toEqual({ placed: 7, unplaced: 1 });
  });

  it('shows the field the front end sends that the DTO lacks, and the required one it never sends', () => {
    const invoice = run.traffic?.find((comparison) => comparison.entry === 'entry:gateway:http:POST:/orders/:param/invoice');
    expect(invoice?.request?.diffs.map((diff) => [diff.kind, diff.path, diff.seenIn, diff.of])).toEqual([
      ['extra_field', 'giftNote', 1, 1],
      ['missing_required', 'status', 0, 1],
    ]);
    expect(printed).toContain('  gateway POST /orders/:param/invoice  2 fields: request giftNote, request status');
  });

  it('lets no value, and no key that is a value, reach the observed file or the summary', () => {
    expectNoValue(readFileSync(run.path, 'utf8'));
    expectNoValue(printed.join('\n'));
    expectNoValue(JSON.stringify(run.traffic));
  });
});
