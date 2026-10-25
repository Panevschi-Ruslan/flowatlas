import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ObservedSpan } from '../span.js';
import { nestjsObserveReader } from './nestjs-observe.js';

/**
 * The @nestjs/observe reader against the SDK's wire contract (P202), as
 * `dist/agent/telemetry-wire-contract.js` of 0.3.12 declares it. The keys
 * below are that contract's, written out by hand: a fixture that uses a key
 * the contract does not declare, or leaves out one it requires, fails here.
 */
const CONTRACT = {
  batch: {
    keys: ['serviceId', 'serviceVersion', 'truncatedSpans', 'forwardLogs', 'snapshots', 'jobs', 'runtime', 'custom', 'logs', 'objectives'],
    required: ['serviceId'],
  },
  snapshot: { keys: ['ct', 'ti', 'd', 'p', 'op', 'u', 'tg', 'e', 'rq', 'a', 't'], required: ['ti', 't'] },
  answer: { keys: ['m', 'sc', 'ou'], required: [] },
  job: { keys: ['i', 'ti', 'n', 'q', 's', 'c', 'd', 'ea', 'wd', 'am', 'ma', 'tg', 'e', 't'], required: ['i', 'ti', 't'] },
  node: { keys: ['n', 'o', 't', 'd', 'e', 'c', 'm', 's', 'so', 'ch'], required: ['o', 'c', 'm'] },
  log: { keys: ['timestamp', 'text', 'traceId', 'spanId', 'level', 'context', 'attributes'], required: ['timestamp', 'text'] },
  custom: {
    keys: ['n', 't', 'v', 'tg', 'd', 'l', 'lu', 'k', 'iv', 'q50', 'q95', 'q99', 'ct', 'sm', 'mx'],
    required: ['n', 't'],
  },
  objective: { keys: ['handler', 'operationId', 'method', 'objectives'], required: ['handler', 'operationId', 'objectives'] },
} as const;

type Json = Record<string, unknown>;

/** What a document says against the contract: one line per key it does not declare or required key it leaves out. */
const problemsOf = (batch: Json): string[] => {
  const problems: string[] = [];
  const check = (value: unknown, record: keyof typeof CONTRACT, at: string): void => {
    const { keys, required } = CONTRACT[record];
    const object = value as Json;
    for (const key of Object.keys(object)) if (!(keys as readonly string[]).includes(key)) problems.push(`${at}.${key}: not declared`);
    for (const key of required) if (object[key] === undefined || object[key] === null) problems.push(`${at}.${key}: required`);
  };
  const tree = (nodes: unknown, at: string): void => {
    (nodes as Json[]).forEach((node, index) => {
      check(node, 'node', `${at}[${index}]`);
      if (node['o'] !== 'auto' && node['o'] !== 'manual') problems.push(`${at}[${index}].o: not auto or manual`);
      if (node['ch'] !== undefined) tree(node['ch'], `${at}[${index}].ch`);
    });
  };
  check(batch, 'batch', 'batch');
  ((batch['snapshots'] as Json[] | undefined) ?? []).forEach((snapshot, index) => {
    check(snapshot, 'snapshot', `snapshots[${index}]`);
    if (snapshot['a'] !== undefined) check(snapshot['a'], 'answer', `snapshots[${index}].a`);
    if (snapshot['st'] !== undefined) problems.push(`snapshots[${index}].st: the agent deletes it`);
    tree(snapshot['t'], `snapshots[${index}].t`);
  });
  ((batch['jobs'] as Json[] | undefined) ?? []).forEach((job, index) => {
    check(job, 'job', `jobs[${index}]`);
    if (job['s'] !== undefined && job['s'] !== 'completed' && job['s'] !== 'failed') problems.push(`jobs[${index}].s: not completed or failed`);
    tree(job['t'], `jobs[${index}].t`);
  });
  ((batch['logs'] as Json[] | undefined) ?? []).forEach((log, index) => check(log, 'log', `logs[${index}]`));
  ((batch['custom'] as Json[] | undefined) ?? []).forEach((metric, index) => check(metric, 'custom', `custom[${index}]`));
  ((batch['objectives'] as Json[] | undefined) ?? []).forEach((objective, index) => check(objective, 'objective', `objectives[${index}]`));
  return problems;
};

const traces = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/multi-repo/traces');
const fixture = (name: string): Json => JSON.parse(readFileSync(join(traces, name), 'utf8')) as Json;

const read = (document: unknown, shapes = false) => nestjsObserveReader.read(document, undefined, shapes ? { shapes: true } : {});
const batchOf = (snapshots: Json[], jobs?: Json[]): Json => ({ serviceId: 'shop', snapshots, ...(jobs === undefined ? {} : { jobs }) });
const node = (c: string, m: string, extra: Json = {}): Json => ({ o: 'auto', c, m, ...extra });

describe('the fixtures follow the @nestjs/observe 0.3.12 wire contract', () => {
  it('billing.observe.json declares only what the contract declares, and every required field', () => {
    expect(problemsOf(fixture('billing.observe.json'))).toEqual([]);
  });

  it('orders.observe.json, the answer to billing in the same trace (P209)', () => {
    expect(problemsOf(fixture('orders.observe.json'))).toEqual([]);
  });

  it('billing.batches.observe.json, batch by batch', () => {
    for (const batch of fixture('billing.batches.observe.json')['batches'] as Json[]) expect(problemsOf(batch)).toEqual([]);
  });

  it('the check itself refuses a key the contract does not declare', () => {
    expect(problemsOf({ serviceId: 'shop', snapshots: [{ ti: 't', st: 1, t: [{ o: 'auto', c: 'A', m: 'b', x: 1 }] }] })).toEqual([
      'snapshots[0].st: not declared',
      'snapshots[0].st: the agent deletes it',
      'snapshots[0].t[0].x: not declared',
    ]);
  });
});

describe('a request snapshot (P202)', () => {
  it('reads `op` as the route template Nest matched, and the URL folded for a request no route matched as its path shape', () => {
    const { spans } = read(
      batchOf([
        { ti: 'a', p: 'http', op: '/invoices/:id', a: { m: 'GET', sc: 200, ou: '/invoices/inv-1?x=1' }, t: [] },
        // No route matched (a guard refused it): the agent sends the URL, query cut, as the operation.
        { ti: 'b', p: 'http', op: '/invoices/inv-2', a: { m: 'GET', sc: 403, ou: '/invoices/inv-2?expand=lines' }, t: [] },
        // A UUID segment is folded to `:id` by the agent.
        { ti: 'c', p: 'https', op: '/carts/:id/items/7', a: { m: 'GET', sc: 403, ou: '/carts/0199f3a2-7c40-7e2a-9b51-3c0e4d5f6a01/items/7' }, t: [] },
        // A static route is its URL: kept as the route.
        { ti: 'd', p: 'http', op: '/health', a: { m: 'GET', sc: 200, ou: '/health' }, t: [] },
        // A hand export's `METHOD /template`.
        { ti: 'e', op: 'DELETE /carts/:id', a: { sc: 204 }, t: [] },
      ]),
    );
    expect(spans.map(({ method, route, path, status }) => ({ method, route, path, status }))).toEqual([
      { method: 'GET', route: '/invoices/:id', path: '/invoices/:value', status: 200 },
      { method: 'GET', route: undefined, path: '/invoices/:value', status: 403 },
      { method: 'GET', route: undefined, path: '/carts/:value/items/:value', status: 403 },
      { method: 'GET', route: '/health', path: '/health', status: 200 },
      { method: 'DELETE', route: '/carts/:id', path: undefined, status: 204 },
    ]);
    expect(JSON.stringify(spans)).not.toMatch(/inv-1|inv-2|0199f3a2/);
  });

  it('reads `ct` (ISO) as the time, `d` as milliseconds and `e` as an error only', () => {
    const [server] = read(
      batchOf([
        {
          ti: 'a',
          ct: '2026-03-01T10:00:00.000Z',
          d: 12.3456,
          p: 'http',
          op: '/orders',
          a: { m: 'POST', sc: 500, ou: '/orders' },
          e: { cls: 'Error', message: 'boom for customer 7', stack: 'Error: boom' },
          t: [],
        },
      ]),
    ).spans;
    expect(server).toEqual({
      traceId: 'a',
      spanId: 'a:shop/0',
      kind: 'server',
      service: 'shop',
      method: 'POST',
      route: '/orders',
      path: '/orders',
      at: '2026-03-01T10:00:00.000Z',
      status: 500,
      durationMs: 12.35,
      error: true,
    });
  });

  it('reads a GraphQL operation over HTTP for its spans only: `op` is the root field and `ou` the document, not a URL', () => {
    const { spans, skipped } = read(
      batchOf([
        {
          ti: 'g',
          p: 'http',
          op: 'Query.invoices',
          a: { m: 'POST', sc: 200, ou: 'query { invoices(customer: "cus-9") { id } }' },
          t: [node('InvoicesResolver', 'invoices')],
        },
        { ti: 'h', p: 'graphql', op: 'Mutation.pay', t: [node('PaymentsResolver', 'pay')] },
      ]),
    );
    expect(spans.map((span) => [span.kind, span.symbol, span.parentId])).toEqual([
      ['internal', 'InvoicesResolver.invoices', 'g:shop/0'],
      ['internal', 'PaymentsResolver.pay', 'h:shop/1'],
    ]);
    expect(skipped).toEqual([{ noun: 'snapshot', why: 'of a GraphQL operation, read for its spans only', count: 2 }]);
    expect(JSON.stringify(spans)).not.toContain('cus-9');
  });

  it('reads a gateway message as a consumer span of its event, and a broker transport as one of its pattern', () => {
    const { spans } = read(
      batchOf([
        { ti: 'w', p: 'ws', op: 'CartGateway:cart:updated', d: 1, t: [node('CartGateway', 'onUpdated')] },
        { ti: 'k', p: 'KAFKA', op: 'order.created', d: 2, e: { message: 'x' }, t: [] },
        { ti: 'r', p: 'RMQ', op: 'invoice.requested', t: [] },
      ]),
    );
    expect(spans.filter((span) => span.kind === 'consumer').map(({ destination, durationMs, error }) => ({ destination, durationMs, error }))).toEqual([
      { destination: 'cart:updated', durationMs: 1, error: undefined },
      { destination: 'order.created', durationMs: 2, error: true },
      { destination: 'invoice.requested', durationMs: undefined, error: undefined },
    ]);
    expect(spans.find((span) => span.symbol === 'CartGateway.onUpdated')?.parentId).toBe('w:shop/0');
  });

  it('reads a request on another transport (TCP, gRPC, a custom one) as a server span of its RPC pattern', () => {
    const { spans, skipped } = read(
      batchOf([
        { ti: 't', p: 'TCP', op: 'sum', t: [] },
        { ti: 'g', p: 'GRPC', op: 'HeroesService/FindOne', t: [] },
        { ti: 'c', p: 'my-transport', t: [] },
      ]),
    );
    expect(spans.map(({ kind, rpc }) => ({ kind, rpc }))).toEqual([
      { kind: 'server', rpc: 'sum' },
      { kind: 'server', rpc: 'HeroesService/FindOne' },
    ]);
    expect(skipped).toEqual([{ noun: 'snapshot', why: 'of protocol my-transport without an operation', count: 1 }]);
  });

  it("keeps two services' snapshots of one request apart: the span ids it makes up say the service (P222)", () => {
    // The caller's agent sends its `ti` on and the callee's adopts it, so both batches report `r1`, each as its snapshot 0.
    const idsOf = (serviceId: string): Array<[string, string | undefined]> =>
      read({ serviceId, snapshots: [{ ti: 'r1', p: 'http', op: '/a', a: { m: 'GET', sc: 200 }, t: [node('A', 'b')] }] }).spans.map(
        (span) => [span.spanId, span.parentId],
      );
    expect(idsOf('caller')).toEqual([
      ['r1:caller/0', undefined],
      ['r1:caller/0:1', 'r1:caller/0'],
    ]);
    expect(idsOf('callee')).toEqual([
      ['r1:callee/0', undefined],
      ['r1:callee/0:1', 'r1:callee/0'],
    ]);
    // A bare array of snapshots names no service: its ids are as they were.
    expect(read([{ ti: 'r1', p: 'http', op: '/a', a: { m: 'GET' }, t: [] }]).spans[0]!.spanId).toBe('r1:0');
  });
});

describe('a span tree (P202)', () => {
  const tree = (nodes: Json[]): ObservedSpan[] =>
    read(batchOf([{ ti: 'a', ct: '2026-03-01T10:00:00.000Z', p: 'http', op: '/orders', a: { m: 'GET', ou: '/orders' }, t: nodes }])).spans.slice(1);

  it('places a node at the trace start plus its start offset `so`', () => {
    const [first, second] = tree([node('OrdersController', 'list', { so: 0, d: 5, ch: [node('OrdersService', 'list', { so: 1500.4, d: 2 })] })]);
    expect(first).toMatchObject({ at: '2026-03-01T10:00:00.000Z', durationMs: 5 });
    expect(second).toMatchObject({ at: '2026-03-01T10:00:01.500Z', durationMs: 2, parentId: first!.spanId });
  });

  it('reads a manual span as no call of its own: its children are read under the method it was opened in', () => {
    const spans = tree([
      node('OrdersController', 'list', {
        d: 5,
        ch: [{ n: 'load page', o: 'manual', c: 'OrdersController', m: 'list', d: 3, e: true, ch: [node('OrdersService', 'page', { d: 2 })] }],
      }),
    ]);
    expect(spans.map((span) => [span.symbol, span.parentId])).toEqual([
      ['OrdersController.list', 'a:shop/0'],
      ['OrdersService.page', spans[0]!.spanId],
    ]);
  });

  it('reads a node the agent folded as the calls it stands for, each the mean of their summed duration', () => {
    const spans = tree([
      node('OrdersService', 'list', {
        ch: [
          node('mongodb', 'find orders', { d: 30, t: { 'observe.collapsed': 3, 'db.statement': '{"find":"orders"}' }, ch: [node('Mapper', 'map', { d: 1 })] }),
        ],
      }),
    ]);
    const finds = spans.filter((span) => span.collection === 'orders');
    expect(finds.map((span) => span.durationMs)).toEqual([10, 10, 10]);
    expect(new Set(finds.map((span) => span.spanId)).size).toBe(3);
    expect(spans.find((span) => span.symbol === 'Mapper.map')?.parentId).toBe(finds[0]!.spanId);
  });

  it('counts a folded http node as its calls, without their URLs', () => {
    const { skipped } = read(
      batchOf([{ ti: 'a', p: 'http', op: '/orders', a: { m: 'GET' }, t: [node('http', 'GET catalog.internal', { d: 9, t: { 'observe.collapsed': 21 } })] }]),
    );
    expect(skipped).toEqual([{ noun: 'node', why: 'of class http folded by the agent, without its URLs', count: 21 }]);
  });

  it('reads `e: true` on a node, and a database node of pg and mysql2 by its table', () => {
    const spans = tree([
      node('pg', 'SELECT orders', { e: true }),
      node('mysql2', 'UPDATE carts'),
      node('pg', 'QUERY'),
    ]);
    expect(spans.map(({ collection, error }) => ({ collection, error }))).toEqual([
      { collection: 'orders', error: true },
      { collection: 'carts', error: undefined },
    ]);
  });
});

describe('a job (P202)', () => {
  it('reads a queue job as a consumer span of its queue: `c` called at, `s` failed is an error, its tree under it', () => {
    const { spans } = read(
      batchOf(
        [],
        [
          {
            i: '41',
            ti: 'req-7',
            n: 'send-receipt',
            q: 'receipts',
            s: 'failed',
            c: '2026-03-01T10:00:00.000Z',
            d: 120,
            wd: 4000,
            am: 2,
            ma: 3,
            t: [node('ReceiptsProcessor', 'process', { d: 110, so: 1 })],
          },
          { i: '42', ti: 'req-8', n: 'send-receipt', q: 'receipts', s: 'completed', c: '2026-03-01T10:00:05.000Z', d: 80, t: [] },
        ],
      ),
    );
    expect(spans).toEqual([
      {
        traceId: 'req-7',
        spanId: 'req-7:job:shop/0',
        kind: 'consumer',
        service: 'shop',
        destination: 'receipts',
        at: '2026-03-01T10:00:00.000Z',
        durationMs: 120,
        error: true,
      },
      expect.objectContaining({ symbol: 'ReceiptsProcessor.process', parentId: 'req-7:job:shop/0', at: '2026-03-01T10:00:00.001Z' }),
      expect.objectContaining({ kind: 'consumer', destination: 'receipts', durationMs: 80 }),
    ]);
    expect(spans[2]).not.toHaveProperty('error');
  });

  it('reads a scheduled run for its tree only: a timer, not a queue', () => {
    const { spans } = read(
      batchOf(
        [],
        [
          { i: '1', ti: 'cron-1', n: 'ReportsService.nightly', q: 'cron', s: 'completed', c: '2026-03-01T02:00:00.000Z', d: 5, t: [node('ReportsService', 'nightly', { d: 5 })] },
          { i: '2', ti: 'iv-1', n: 'sweep', q: 'interval', t: [] },
        ],
      ),
    );
    expect(spans.map(({ kind, symbol, destination }) => ({ kind, symbol, destination }))).toEqual([
      { kind: 'internal', symbol: 'ReportsService.nightly', destination: undefined },
    ]);
  });

  it('no longer reads `ct` on a job: the contract calls it `c`', () => {
    const [consumer] = read(batchOf([], [{ i: '1', ti: 'j', q: 'q', ct: '2026-03-01T02:00:00.000Z', t: [] }])).spans;
    expect(consumer).not.toHaveProperty('at');
  });
});

describe('a captured request with --shapes (P202)', () => {
  const snapshot = (rq: Json): Json => batchOf([{ ti: 'a', p: 'http', op: '/orders', a: { m: 'POST', sc: 500, ou: '/orders' }, rq, t: [] }]);

  it('reads `rq.body` as the JSON text the agent serialised', () => {
    const { bodies } = read(snapshot({ headers: { 'content-type': 'application/json' }, body: '{"sku":"s-1","qty":2}' }), true);
    expect(bodies?.[0]?.request).toEqual({
      t: 'object',
      n: 1,
      f: { qty: { s: { t: 'number', n: 1 }, n: 1 }, sku: { s: { t: 'string', n: 1 }, n: 1 } },
    });
  });

  it('counts a body the agent cut to its size limit, and never parses it', () => {
    const { bodies, skipped } = read(snapshot({ body: '{"sku":"s-1","li', bodyTruncated: true }), true);
    expect(bodies).toEqual([]);
    expect(skipped).toEqual([{ noun: 'body', why: 'cut short by the agent', count: 1 }]);
  });
});
