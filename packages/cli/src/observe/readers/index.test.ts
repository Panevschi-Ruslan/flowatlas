import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOW_LISTS, NESTJS_OBSERVE_READS, only } from '../allow-list.js';
import { BODY_VALUES, PLANTED } from '../__fixtures__/planted.js';
import { nestjsObserveReader, otlpReader, readerFor, TRACE_READERS } from './index.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/multi-repo');
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
        spanId: 'e1000000000000000000000000000001:billing/0',
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
    ]);
  });

  it('reads a message on a broker transport as a consumer span of its pattern (P202)', () => {
    expect(read.spans.filter((span) => span.kind === 'consumer')).toEqual([
      {
        traceId: 'e1000000000000000000000000000003',
        spanId: 'e1000000000000000000000000000003:billing/2',
        kind: 'consumer',
        service: 'billing',
        destination: 'order.created',
        at: '2025-10-16T07:33:32.000Z',
        durationMs: 0.9,
      },
    ]);
  });

  it('reads the span tree from t, nested, with parents; a manual span is not a call of its own', () => {
    const symbols = read.spans.filter((span) => span.symbol !== undefined);
    expect(symbols.map((span) => span.symbol)).toEqual([
      'InvoicesController.create',
      'InvoicesService.create',
      'InvoicesController.findOne',
      'InvoicesService.findOne',
      'InvoicesConsumer.onOrderCreated',
      'InvoicesService.create',
      'InvoicesService.findOne',
    ]);
    const [controller, service] = symbols;
    expect(controller!.parentId).toBe('e1000000000000000000000000000001:billing/0');
    expect(service!.parentId).toBe(controller!.spanId);
    // The manual span names InvoicesController.create again, the method it was opened in: not counted twice.
    expect(symbols.filter((span) => span.traceId === controller!.traceId && span.symbol === 'InvoicesController.create')).toHaveLength(1);
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

  it('reads every part of a batch in the contract: nothing skipped', () => {
    expect(read.skipped).toEqual([]);
  });

  it('counts a database node without a collection, an http node without a URL and a node the contract refuses', () => {
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
            { n: 'a node the contract refuses', d: 0.1 },
          ],
        },
      ],
    });
    expect(spans).toHaveLength(1);
    expect(skipped).toEqual([
      { noun: 'node', why: 'of class pg without a collection', count: 1 },
      { noun: 'node', why: 'of class http without a method and a URL', count: 1 },
      { noun: 'node', why: 'without o, c and m', count: 1 },
    ]);
  });

  it('takes the service from --service when the batch names none, and a time only Date.parse trusts', () => {
    const { spans } = nestjsObserveReader.read([{ ti: 't1', ct: 'yesterday', a: { m: 'get', ou: '/cart' } }], 'shop');
    expect(spans).toEqual([{ traceId: 't1', spanId: 't1:shop/0', kind: 'server', service: 'shop', method: 'GET', path: '/cart' }]);
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

  it('reads peer.service as a name only: an address dropped, a value-like name masked (P146)', () => {
    const client = (spanId: string, peer: string) => ({
      traceId: 't',
      spanId,
      kind: 3,
      attributes: [
        { key: 'http.request.method', value: { stringValue: 'POST' } },
        { key: 'url.full', value: { stringValue: 'https://ledger.example.test/entries?token=x' } },
        { key: 'peer.service', value: { stringValue: peer } },
      ],
    });
    const { spans, droppedAttributes } = otlpReader.read({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'shop' } }] },
          scopeSpans: [
            {
              spans: [
                client('a', ' ledger '),
                client('b', 'ledger.internal.example.test'),
                client('c', '10.0.4.2:8443'),
                client('d', 'ledger-7f3a9c'),
                client('e', 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'),
              ],
            },
          ],
        },
      ],
    });
    expect(spans.map((span) => span.peerName)).toEqual(['ledger', undefined, undefined, ':value', ':value']);
    expect(spans[0]).toMatchObject({ kind: 'client', method: 'POST', path: '/entries' });
    expect(droppedAttributes).toBe(0);
    expect(JSON.stringify(spans)).not.toMatch(/10\.0\.4\.2|internal\.example|7f3a9c|a1b2c3d4/);
  });
});

describe('a saved series of @nestjs/observe batch posts', () => {
  const series = JSON.parse(readFileSync(join(fixture, 'traces/billing.batches.observe.json'), 'utf8')) as Record<string, unknown>;

  it('reads as the batches one after another, durations and errors on every node', () => {
    expect(readerFor(series)).toBe(nestjsObserveReader);
    const { spans, droppedAttributes } = nestjsObserveReader.read(series);
    const servers = spans.filter((span) => span.kind === 'server');
    expect(servers.slice(0, 3).map((span) => [span.method, span.route, span.status, span.durationMs, span.error ?? false])).toEqual([
      ['GET', '/invoices/:id', 200, 3.2, false],
      ['GET', '/invoices/:id', 404, 2.8, false],
      ['POST', '/invoices', 500, 41.5, true],
    ]);
    // The third batch: twenty writes that all answer 201, so POST /invoices is
    // hit often enough for the 409 it declares and never answers to be said (P106).
    expect(servers.slice(3).map((span) => `${span.method} ${span.route} ${span.status}`)).toEqual(Array(20).fill('POST /invoices 201'));
    expect(spans.find((span) => span.symbol === 'InvoicesService.create')).toMatchObject({ durationMs: 40.2, error: true });
    // Span ids stay unique across the batches.
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(spans.length);
    // A user, a request, a version, a statement: counted as not read, never kept.
    expect(droppedAttributes).toBeGreaterThan(3);
    const text = JSON.stringify(spans);
    for (const secret of PLANTED) expect(text).not.toContain(secret);
  });
});

describe('the @nestjs/observe reader with --shapes (P113)', () => {
  /** A snapshot whose captured request throws when read: nothing may touch it without --shapes. */
  const trapped = (): unknown => {
    const snapshot: Record<string, unknown> = { ti: 't1', p: 'http', op: 'POST /invoices', a: { m: 'POST', sc: 201 } };
    Object.defineProperty(snapshot, 'rq', { enumerable: true, get: () => { throw new Error('rq was read'); } });
    return { serviceId: 'billing', snapshots: [snapshot] };
  };

  it('never touches the captured request without --shapes, and reads it only with', () => {
    expect(() => nestjsObserveReader.read(trapped())).not.toThrow();
    expect(nestjsObserveReader.read(batch)).not.toHaveProperty('bodies');
    expect(() => nestjsObserveReader.read(trapped(), undefined, { shapes: true })).toThrow('rq was read');
  });

  it('keeps the body of rq as key names and JSON types, by its server span, and never its headers', () => {
    const { bodies } = nestjsObserveReader.read(batch, undefined, { shapes: true });
    expect(bodies).toEqual([
      {
        traceId: 'e1000000000000000000000000000001',
        spanId: 'e1000000000000000000000000000001:billing/0',
        request: {
          t: 'object',
          n: 1,
          f: {
            amount: { s: { t: 'number', n: 1 }, n: 1 },
            memo: { s: { t: 'string', n: 1 }, n: 1 },
            orderId: { s: { t: 'string', n: 1 }, n: 1 },
          },
        },
      },
    ]);
    const text = JSON.stringify(bodies);
    for (const value of [...BODY_VALUES, 'authorization', 'headers', 'Bearer']) expect(text, value).not.toContain(value);
  });
});
