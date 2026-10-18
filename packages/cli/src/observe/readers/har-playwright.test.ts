import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, toPosixPath, type GraphNode } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { settingsOfProject } from '../../build/settings/index.js';
import { readTraceFiles } from '../../commands/observe.js';
import { frontEndContextOf } from '../origins.js';
import { traceFilesNamed } from '../trace-paths.js';
import { harReader } from './har.js';

/**
 * Run time from an end-to-end test run (P205): the HAR files Playwright's
 * `recordHar` writes, in each of its shapes (`content: 'embed'` in full mode,
 * `'attach'` in minimal mode with the bodies beside the HAR, and a `.zip`
 * path, the HAR and its bodies in one archive), found under the run's
 * output directory; and a Chrome DevTools "Save all as HAR" export.
 */
const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/multi-repo');
const run = join(fixture, 'traces/playwright');
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as { nodes: GraphNode[] };
const loaded = loadConfig(join(fixture, 'flowatlas.config.json'));
const context = frontEndContextOf(graph.nodes, { config: loaded.config, settings: settingsOfProject(loaded) });
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-playwright-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** Everything planted in the Playwright fixtures that no span, note or shape may hold. */
const PLANTED = [
  'pw-bearer-k2',
  'pw-sess-c4',
  'pw-tok-q5',
  'access_token',
  'pw-note-v3',
  'rf-pw-77',
  '4111-pw-card',
  'pw-carrier-9',
  'pw-host-3',
  'ERR_CONNECTION_RESET',
  'pw-page',
  'pw-test-ca',
  '10.0.9.4',
  'ord-7101',
  'ord-7102',
  'pw-sku-5',
  'inv-pw-31',
  'pw-reason-2',
  'frame@',
  'request@',
  'worker@',
  'pw-test-id-1',
];

const readRun = (shapes = false) => {
  const named = traceFilesNamed([run]);
  return { named, read: readTraceFiles(named.files, undefined, { frontEnd: () => context, ...(shapes ? { shapes: true } : {}) }) };
};

describe('a directory of HAR files from a test run', () => {
  it('reads the HAR files under it, and the HAR inside Playwright’s .zip, and leaves everything else alone', () => {
    const { named } = readRun();
    expect(named.files.map((file) => toPosixPath(relative(run, file)))).toEqual([
      'orders-cancel-firefox/network.zip',
      'orders-invoice-chromium/network.har',
      'orders-refund-chromium/network.har',
    ]);
    // The run's .last-run.json, a page snapshot, Playwright's own trace.zip and the three bodies attached beside a HAR.
    expect(named.notes).toEqual([
      `left alone in ${toPosixPath(run)}: 6 files that are not HAR (a directory is read for its HAR files; name other trace files on their own)`,
    ]);
  });

  it('takes a quoted glob too, and refuses a directory with no HAR in it or a glob that matches nothing', () => {
    const glob = traceFilesNamed(['playwright/**/*.har'], join(fixture, 'traces'));
    expect(glob).toEqual({ files: ['playwright/orders-invoice-chromium/network.har', 'playwright/orders-refund-chromium/network.har'], notes: [] });
    const empty = join(scratch, 'empty-run');
    mkdirSync(join(empty, 'a-test'), { recursive: true });
    writeFileSync(join(empty, 'a-test', 'video.webm'), 'not a video');
    expect(() => traceFilesNamed([empty])).toThrow(/holds no HAR file: a directory is read for its .har, .har.gz and Playwright .zip files/);
    expect(() => traceFilesNamed(['playwright/**/*.nothing'], join(fixture, 'traces'))).toThrow('playwright/**/*.nothing matches no file');
  });

  it('reads each call the page made: its method, path shape, status, time and the service its origin names', () => {
    const { read } = readRun();
    expect(Object.values(read.formats)).toEqual(['har', 'har', 'har']);
    const calls = read.spans.map(({ method, path, status, error, durationMs, peerService, at }) => ({ method, path, status, error, durationMs, peerService, at }));
    expect(calls).toEqual([
      { method: 'POST', path: '/orders/:value/cancel', status: 200, error: undefined, durationMs: 33.3, peerService: 'gateway', at: '2025-10-16T08:42:00.000Z' },
      { method: 'POST', path: '/orders/:value/invoice', status: 500, error: undefined, durationMs: 211.4, peerService: 'gateway', at: '2025-10-16T08:41:00.200Z' },
      { method: 'GET', path: '/orders/:value/receipt', status: 404, error: undefined, durationMs: 9.8, peerService: 'gateway', at: '2025-10-16T08:41:01.000Z' },
      { method: 'GET', path: '/orders/:value', status: 200, error: undefined, durationMs: 21, peerService: 'gateway', at: '2025-10-16T08:41:02.000Z' },
      { method: 'GET', path: '/orders/:value', status: 200, error: undefined, durationMs: 48.37, peerService: 'gateway', at: '2025-10-16T08:40:00.300Z' },
      { method: 'POST', path: '/orders/:value/refund', status: 201, error: undefined, durationMs: 63.1, peerService: 'gateway', at: '2025-10-16T08:40:01.000Z' },
      // Playwright writes a call that got no answer with status -1.
      { method: 'POST', path: '/orders/:value/ship', status: undefined, error: true, durationMs: 12, peerService: 'gateway', at: '2025-10-16T08:40:02.000Z' },
    ]);
    expect(read.spans.every((span) => span.service === 'web' && span.kind === 'client')).toBe(true);
  });

  it('counts what was not the page’s own call to a server: the test’s request API, a service worker, route.fulfill', () => {
    const { read } = readRun();
    expect(read.skipped).toEqual([
      { noun: 'entry', why: 'of type image', count: 1 },
      { noun: 'entry', why: 'made by a service worker', count: 1 },
      { noun: 'entry', why: 'of type document', count: 1 },
      { noun: 'entry', why: 'of type script', count: 1 },
      { noun: 'entry', why: 'made by the test through its request API, not by the page', count: 1 },
      { noun: 'entry', why: 'answered by the test (route.fulfill), not by a server', count: 1 },
    ]);
  });

  it('copies nothing planted: no header, cookie, query, body, failure text, address or Playwright reference', () => {
    const { read } = readRun(true);
    const text = JSON.stringify(read);
    for (const value of PLANTED) expect(text, value).not.toContain(value);
  });
});

describe('the bodies of a test run’s HAR files, with --shapes', () => {
  const { read } = readRun(true);
  const shapeOf = (method: string, path: string, side: 'request' | 'response') => {
    const span = read.spans.find((item) => item.method === method && item.path === path);
    return read.bodies?.find((body) => body.spanId === span?.spanId)?.[side];
  };
  const fields = (shape: unknown): string[] => Object.keys((shape as { f?: Record<string, unknown> } | undefined)?.f ?? {}).sort();

  it('reads an embedded body inline (content: embed)', () => {
    expect(fields(shapeOf('POST', '/orders/:value/refund', 'request'))).toEqual(['amount', 'note', 'reason']);
    expect(fields(shapeOf('POST', '/orders/:value/refund', 'response'))).toEqual(['id', 'refundId', 'status']);
  });

  it('reads an attached body from the file beside the HAR (content: attach), and counts one whose file is gone', () => {
    expect(fields(shapeOf('POST', '/orders/:value/invoice', 'request'))).toEqual(['dueInDays', 'lines']);
    expect(fields(shapeOf('POST', '/orders/:value/invoice', 'response'))).toEqual(['invoiceId', 'total']);
    expect(fields(shapeOf('GET', '/orders/:value/receipt', 'response'))).toEqual(['message']);
    expect(read.skipped).toContainEqual({ noun: 'body', why: 'attached in a file that is not beside the HAR', count: 1 });
  });

  it('reads an attached body from the archive the HAR came in (a .zip path)', () => {
    expect(fields(shapeOf('POST', '/orders/:value/cancel', 'request'))).toEqual(['reason']);
    expect(fields(shapeOf('POST', '/orders/:value/cancel', 'response'))).toEqual(['id', 'status']);
  });

  it('reads no attached file without --shapes, and none under a name that is a path', () => {
    const copy = join(scratch, 'escape');
    cpSync(join(run, 'orders-invoice-chromium'), copy, { recursive: true });
    const harPath = join(copy, 'network.har');
    const document = JSON.parse(readFileSync(harPath, 'utf8')) as { log: { entries: Array<{ response: { content: Record<string, unknown> } }> } };
    for (const entry of document.log.entries) if (entry.response.content['_file'] !== undefined) entry.response.content['_file'] = '../flowatlas.config.json';
    writeFileSync(harPath, JSON.stringify(document));
    const shaped = readTraceFiles([harPath], undefined, { frontEnd: () => context, shapes: true });
    expect(shaped.skipped).toContainEqual({ noun: 'body', why: 'attached under a name that is not a file beside the HAR', count: 3 });
    const unshaped = readTraceFiles([harPath], undefined, { frontEnd: () => context });
    expect(unshaped.bodies).toBeUndefined();
    expect(unshaped.skipped.some((part) => part.noun === 'body')).toBe(false);
  });

  it('says when a HAR holds no bodies at all (content: omit)', () => {
    const omitted = join(scratch, 'omit.har');
    const document = JSON.parse(readFileSync(join(run, 'orders-refund-chromium/network.har'), 'utf8')) as {
      log: { entries: Array<{ request: Record<string, unknown>; response: { content: Record<string, unknown> } }> };
    };
    for (const entry of document.log.entries) {
      delete entry.request['postData'];
      delete entry.response.content['text'];
    }
    writeFileSync(omitted, JSON.stringify(document));
    const { notes } = readTraceFiles([omitted], undefined, { frontEnd: () => context, shapes: true });
    expect(notes).toContain(
      'the HAR holds no bodies (Playwright’s content: \'omit\'), so --shapes read nothing of it: record with content: \'embed\' or \'attach\'',
    );
  });
});

describe('a Chrome DevTools "Save all as HAR" export', () => {
  /** The fields DevTools writes and Playwright does not: `_initiator`, `_priority`, `_fromCache`, `_error`, `_connectionId`, base64 content. */
  const devtools = {
    log: {
      version: '1.2',
      creator: { name: 'WebInspector', version: '537.36' },
      pages: [{ startedDateTime: '2025-10-16T08:50:00.000Z', id: 'page_7', title: 'https://shop.example.test/', pageTimings: {} }],
      entries: [
        {
          _initiator: { type: 'script', stack: { callFrames: [{ url: 'https://shop.example.test/main.js', functionName: 'dt-fn-4' }] } },
          _priority: 'High',
          _resourceType: 'fetch',
          _connectionId: 'dt-conn-8',
          cache: {},
          pageref: 'page_7',
          startedDateTime: '2025-10-16T08:50:00.100Z',
          time: 41.2,
          request: { method: 'GET', url: 'https://gateway.example.test/orders/dt-ord-1', headers: [{ name: 'cookie', value: 'dt-sess' }], queryString: [], cookies: [], httpVersion: 'h2', headersSize: -1, bodySize: 0 },
          response: {
            status: 200,
            statusText: '',
            httpVersion: 'h2',
            headers: [],
            cookies: [],
            content: { size: 30, mimeType: 'application/json', text: Buffer.from('{"id":"dt-ord-1","paid":true}').toString('base64'), encoding: 'base64' },
            redirectURL: '',
            headersSize: -1,
            bodySize: -1,
            _transferSize: 120,
            _error: null,
          },
          serverIPAddress: '[::1]',
          timings: { blocked: 1, dns: -1, ssl: -1, connect: -1, send: 0.1, wait: 38, receive: 2.1, _blocked_queueing: 0.8 },
        },
        {
          _resourceType: 'xhr',
          _fromCache: 'disk',
          startedDateTime: '2025-10-16T08:50:01.000Z',
          time: 0.4,
          request: { method: 'POST', url: 'https://gateway.example.test/orders/dt-ord-1/refund', headers: [], queryString: [], cookies: [], httpVersion: '', headersSize: -1, bodySize: 0 },
          response: { status: 0, statusText: '', httpVersion: '', headers: [], cookies: [], content: { size: 0, mimeType: 'x-unknown' }, redirectURL: '', headersSize: -1, bodySize: -1, _transferSize: 0, _error: 'net::ERR_BLOCKED_BY_CLIENT' },
          timings: { blocked: -1, dns: -1, ssl: -1, connect: -1, send: 0, wait: 0, receive: 0 },
        },
      ],
    },
  };

  it('reads each call DevTools saved, a blocked one as failed with no status, a base64 body for its shape', () => {
    const { spans, bodies, skipped } = harReader.read(devtools, 'web', { frontEnd: () => context, shapes: true });
    expect(spans.map(({ method, path, status, error, peerService }) => ({ method, path, status, error, peerService }))).toEqual([
      { method: 'GET', path: '/orders/:value', status: 200, error: undefined, peerService: 'gateway' },
      { method: 'POST', path: '/orders/:value/refund', status: undefined, error: true, peerService: 'gateway' },
    ]);
    expect(Object.keys((bodies?.[0]?.response as { f: Record<string, unknown> }).f).sort()).toEqual(['id', 'paid']);
    expect(skipped).toEqual([]);
    expect(JSON.stringify({ spans, bodies })).not.toMatch(/dt-ord-1|dt-fn-4|dt-conn-8|dt-sess|ERR_BLOCKED/);
  });
});
