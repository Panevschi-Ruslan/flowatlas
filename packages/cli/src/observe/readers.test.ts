import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOW_LISTS, NESTJS_OBSERVE_READS, only } from './allow-list.js';
import { PLANTED } from './__fixtures__/planted.js';
import { nestjsObserveReader, otlpReader, readerFor, TRACE_READERS } from './readers.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const batch = JSON.parse(readFileSync(join(fixture, 'traces/billing.observe.json'), 'utf8')) as Record<string, unknown>;

describe('the @nestjs/observe reader', () => {
  const read = nestjsObserveReader.read(batch);

  it('recognises a telemetry batch and a bare snapshot array, and nothing else', () => {
    expect(readerFor(batch)).toBe(nestjsObserveReader);
    expect(readerFor({ serviceId: 'shop', snapshots: [] })).toBe(nestjsObserveReader);
    expect(readerFor([{ ti: 't1', p: 'http', a: { m: 'GET' } }])).toBe(nestjsObserveReader);
    expect(readerFor({ resourceSpans: [] })).toBe(otlpReader);
    expect(readerFor({ serviceId: 'shop' })).toBeUndefined();
    expect(readerFor([{ something: 'else' }])).toBeUndefined();
    expect(readerFor([])).toBeUndefined();
  });

  it('reads one server span per HTTP snapshot: method, route, path shape, status, duration, time, service', () => {
    const servers = read.spans.filter((span) => span.kind === 'server');
    expect(servers).toEqual([
      {
        traceId: 'e1000000000000000000000000000001',
        spanId: 'e1000000000000000000000000000001:0',
        kind: 'server',
        service: 'billing',
        method: 'POST',
        route: '/invoices',
        path: '/invoices',
        at: '2025-10-16T07:33:30.000Z',
        status: 201,
        durationMs: 6.4,
      },
      expect.objectContaining({ method: 'GET', route: '/invoices/:id', path: '/invoices/:value', status: 200 }),
      // No operation: the request ended before routing, so the URL's shape stands in.
      expect.objectContaining({ method: 'GET', path: '/healthz', status: 404 }),
    ]);
    expect(servers[2]).not.toHaveProperty('route');
  });

  it('reads the span tree from t, nested, with parents; n is optional', () => {
    const symbols = read.spans.filter((span) => span.symbol !== undefined);
    expect(symbols.map((span) => span.symbol)).toEqual([
      'InvoicesController.create',
      'InvoicesService.create',
      'LedgerClient.post',
      'InvoicesController.findOne',
      'InvoicesService.findOne',
    ]);
    const [controller, service, ledger] = symbols;
    expect(controller!.parentId).toBe('e1000000000000000000000000000001:0');
    expect(service!.parentId).toBe(controller!.spanId);
    expect(ledger).toMatchObject({ parentId: controller!.spanId, error: true, durationMs: 2 });
    expect(symbols.at(-1)).toMatchObject({ traceId: 'e1000000000000000000000000000005', at: '2025-10-16T07:33:40.000Z' });
  });

  it('reads an http node as a client span with method and path, and no host', () => {
    const client = read.spans.find((span) => span.kind === 'client' && span.method !== undefined);
    expect(client).toMatchObject({ kind: 'client', method: 'GET', path: '/orders/:value', service: 'billing' });
    expect(client!.parentId).toBe(read.spans.find((span) => span.symbol === 'InvoicesService.create')!.spanId);
  });

  it('reads a database node for its collection only', () => {
    const db = read.spans.find((span) => span.collection !== undefined);
    expect(db).toMatchObject({ kind: 'client', collection: 'invoices', durationMs: 0.8 });
    expect(Object.keys(db!).sort()).toEqual(['at', 'collection', 'durationMs', 'kind', 'parentId', 'service', 'spanId', 'traceId']);
  });

  it('counts what it does not read: other protocols, nodes the contract refuses, jobs without a tree', () => {
    expect(read.skipped).toEqual([
      { noun: 'snapshot', why: 'of protocol ws', count: 1 },
      { noun: 'node', why: 'without o, c and m', count: 1 },
      { noun: 'job', why: 'without a span tree', count: 1 },
    ]);
    expect(read.spans.some((span) => span.symbol === 'InvoicesGateway.watch')).toBe(false);
  });

  it('counts a database node without a collection and an http node without a URL', () => {
    const { spans, skipped } = nestjsObserveReader.read({
      serviceId: 'shop',
      snapshots: [
        {
          ti: 't1',
          p: 'http',
          op: '/cart',
          a: { m: 'GET' },
          t: [
            { o: 'auto', c: 'pg', m: 'SELECT' },
            { o: 'auto', c: 'http', m: 'GET catalog.internal', t: {} },
          ],
        },
      ],
    });
    expect(spans).toHaveLength(1);
    expect(skipped).toEqual([
      { noun: 'node', why: 'of class pg without a collection', count: 1 },
      { noun: 'node', why: 'of class http without a method and a URL', count: 1 },
    ]);
  });

  it('takes the service from --service when the batch names none, and a time only Date.parse trusts', () => {
    const { spans } = nestjsObserveReader.read([{ ti: 't1', ct: 'yesterday', a: { m: 'get', ou: '/cart' } }], 'shop');
    expect(spans).toEqual([{ traceId: 't1', spanId: 't1:0', kind: 'server', service: 'shop', method: 'GET', path: '/cart' }]);
  });

  it('copies no planted value: no token, user, statement, query, host, tag, log line or batch extra', () => {
    const text = JSON.stringify(read);
    for (const secret of PLANTED) expect(text).not.toContain(secret);
  });
});

describe('the allow-lists', () => {
  it('has one list per reader', () => {
    expect(Object.keys(ALLOW_LISTS).sort()).toEqual([...TRACE_READERS.keys()].sort());
  });

  it('keeps only the named fields of a record', () => {
    expect(only({ m: 'GET', h: { authorization: 'x' } }, NESTJS_OBSERVE_READS.answer)).toEqual({ m: 'GET' });
    expect(only('not a record', NESTJS_OBSERVE_READS.answer)).toEqual({});
    for (const never of ['u', 'rq', 'tg']) expect(NESTJS_OBSERVE_READS.snapshot).not.toContain(never);
    for (const never of ['logs', 'objectives', 'runtime', 'custom', 'serviceVersion']) {
      expect(NESTJS_OBSERVE_READS.batch).not.toContain(never);
    }
    expect(NESTJS_OBSERVE_READS.tags).not.toContain('db.statement');
  });
});

describe('the OTLP reader', () => {
  it('reads only listed attributes, status and duration, and counts spans without ids', () => {
    const { spans, skipped } = otlpReader.read({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'shop' } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 't',
                  spanId: 's',
                  kind: 2,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '1005000000',
                  status: { code: 2, message: 'boom at a secret place' },
                  attributes: [
                    { key: 'http.request.method', value: { stringValue: 'GET' } },
                    { key: 'http.route', value: { stringValue: '/cart' } },
                    { key: 'http.response.status_code', value: { intValue: 500 } },
                    { key: 'enduser.id', value: { stringValue: 'user-1' } },
                  ],
                },
                { spanId: 'no-trace' },
              ],
            },
          ],
        },
      ],
    });
    expect(spans).toEqual([
      {
        traceId: 't',
        spanId: 's',
        kind: 'server',
        service: 'shop',
        method: 'GET',
        route: '/cart',
        at: '1970-01-01T00:00:01.000Z',
        status: 500,
        durationMs: 5,
        error: true,
      },
    ]);
    expect(skipped).toEqual([{ noun: 'span', why: 'without a trace id and a span id', count: 1 }]);
  });
});

describe('a saved series of @nestjs/observe batch posts', () => {
  const series = JSON.parse(readFileSync(join(fixture, 'traces/billing.batches.observe.json'), 'utf8')) as Record<string, unknown>;

  it('reads as the batches one after another, durations and errors on every node', () => {
    expect(readerFor(series)).toBe(nestjsObserveReader);
    const { spans, droppedAttributes } = nestjsObserveReader.read(series);
    const servers = spans.filter((span) => span.kind === 'server');
    expect(servers.map((span) => [span.method, span.route, span.status, span.durationMs, span.error ?? false])).toEqual([
      ['GET', '/invoices/:id', 200, 3.2, false],
      ['GET', '/invoices/:id', 404, 2.8, false],
      ['POST', '/invoices', 500, 41.5, true],
    ]);
    expect(spans.find((span) => span.symbol === 'InvoicesService.create')).toMatchObject({ durationMs: 40.2, error: true });
    // Span ids stay unique across the batches.
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(spans.length);
    // A user, a request, a version, a statement: counted as not read, never kept.
    expect(droppedAttributes).toBeGreaterThan(3);
    const text = JSON.stringify(spans);
    for (const secret of PLANTED) expect(text).not.toContain(secret);
  });
});
