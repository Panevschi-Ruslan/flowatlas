import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readObserved, type GraphEdge, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { writeGraphDb, type LinkReport } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { readTraceFiles, runObserve } from '../commands/observe.js';
import { runVisualise } from '../commands/visualise.js';
import { packObserved } from '../visualise/observed.js';
import { ambiguousOf, unmatchedOf } from '../visualise/steps.js';
import { PLANTED } from './__fixtures__/planted.js';
import { edgeIdOf, indexGraph, matchSpans, routeScore, templateOf } from './match.js';
import { nestjsObserveReader, otlpReader, readerFor } from './readers/index.js';
import { pathOf } from './span.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');
const fixture = join(fixtures, 'multi-repo');
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const batchFile = join(fixture, 'traces/billing.observe.json');
const traces = [join(fixture, 'traces/checkout.otlp.json'), batchFile];
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-observe-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('trace readers', () => {
  it('picks the reader by sniffing the document', () => {
    expect(readerFor({ resourceSpans: [] })).toBe(otlpReader);
    expect(readerFor({ serviceId: 'billing', snapshots: [] })).toBe(nestjsObserveReader);
    expect(readerFor({ something: 'else' })).toBeUndefined();
  });

  it('drops values: headers, user ids, queries, statements, hosts and ids in a path', () => {
    const { spans, formats } = readTraceFiles(traces);
    expect(Object.values(formats)).toEqual(['otlp', 'nestjs-observe']);
    const text = JSON.stringify(spans);
    for (const secret of PLANTED) expect(text).not.toContain(secret);
    // A cookie, a statement, a user, a span name and an exception went; the status and the duration stay (P105).
    expect(spans.find((span) => span.spanId === 'c200000000000001')).toMatchObject({ status: 500, durationMs: 35, error: true });
    expect(pathOf('http://h/orders/ord-1042?x=1')).toBe('/orders/:value');
    expect(pathOf('/orders/latest')).toBe('/orders/latest');
  });

  it('reads a gzip copy of the batch as the batch itself, known by the same hash', () => {
    const copy = join(scratch, 'billing.observe.json.gz');
    writeFileSync(copy, gzipSync(readFileSync(batchFile)));
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(readTraceFiles([copy], undefined, { now })).toEqual({
      ...readTraceFiles([batchFile], undefined, { now }),
      formats: { [copy]: 'nestjs-observe' },
    });
    expect(readTraceFiles([batchFile, copy]).repeated).toEqual([copy]);
  });

  it('refuses a truncated gzip file by name', () => {
    const cut = join(scratch, 'cut.json.gz');
    const whole = gzipSync(readFileSync(batchFile));
    writeFileSync(cut, whole.subarray(0, Math.floor(whole.length / 2)));
    expect(() => readTraceFiles([cut])).toThrow(/cut\.json\.gz is gzip and cannot be unpacked/);
  });
});

describe('route matching', () => {
  it('prefers the most literal template and keeps values off literal segments', () => {
    expect(templateOf('/orders/{id}')).toEqual(['orders', ':param']);
    expect(routeScore(templateOf('/orders/:param'), templateOf('/orders/latest'))).toBe(1);
    expect(routeScore(templateOf('/orders/latest'), templateOf('/orders/latest'))).toBe(2);
    expect(routeScore(templateOf('/orders/latest'), templateOf('/orders/:value'))).toBe(-1);
  });
});

describe('matchSpans over the multi-repo fixture', () => {
  const index = indexGraph(graph.nodes, graph.edges);
  const observed = matchSpans(index, readTraceFiles(traces).spans);

  it('reads entries, symbols and times from the @nestjs/observe batch alone', () => {
    const alone = matchSpans(index, readTraceFiles([batchFile]).spans);
    expect(alone.observedFormatVersion).toBe(3);
    expect(alone.entries).toEqual({
      'entry:billing:http:GET:/invoices/:param': expect.objectContaining({ hits: 1, lastSeen: '2025-10-16T07:33:31.000Z', p95: 1.1, statuses: { '200': 1 } }),
      'entry:billing:http:POST:/invoices': expect.objectContaining({ hits: 1, lastSeen: '2025-10-16T07:33:30.000Z', max: 6.4, errors: 0 }),
    });
    expect(alone.symbols).toMatchObject({
      'billing#src/invoices/invoices.controller.ts:InvoicesController.create': { hits: 1 },
      'billing#src/invoices/invoices.service.ts:InvoicesService.create': { hits: 1 },
      // From the job's tree.
      'billing#src/invoices/invoices.service.ts:InvoicesService.findOne': { hits: 1 },
    });
    // billing calls nothing in code, so its outgoing request and its collection are seen, not joined.
    expect(alone.joins).toEqual({});
    expect(alone.unmatched.map(({ service, kind, name, count }) => ({ service, kind, name, count }))).toEqual([
      { service: 'billing', kind: 'client', name: 'GET /orders/:value', count: 1 },
      { service: 'billing', kind: 'code', name: 'LedgerClient.post', count: 1 },
      { service: 'billing', kind: 'db', name: 'invoices', count: 1 },
      { service: 'billing', kind: 'http', name: 'GET /healthz', count: 1 },
    ]);
  });

  it('confirms the cross-service HTTP join from parent and child spans', () => {
    expect(
      observed.joins['http_out:gateway#src/clients/orders.client.ts:33:12 -http_calls-> entry:orders:http:GET:/orders/:param'],
    ).toMatchObject({ count: 1, lastSeen: '2025-10-16T07:33:20.001Z', measuredAt: 'caller', max: 500 });
    // The far side settled which of the two calls that fit the client span it was.
    expect(observed.symbols['http_out:gateway#src/clients/orders.client.ts:33:12']).toMatchObject({ hits: 1 });
  });

  it('credits a call that fits two call sites to neither, and says so', () => {
    expect(observed.ambiguous).toEqual([
      {
        service: 'gateway',
        kind: 'client',
        name: 'GET /orders/:value',
        candidates: [
          'http_out:gateway#src/clients/orders.client.ts:33:12',
          'http_out:gateway#src/clients/orders.client.ts:59:12',
        ],
        count: 1,
      },
    ]);
    expect(observed.symbols['http_out:gateway#src/clients/orders.client.ts:59:12']).toBeUndefined();
  });

  it('confirms both ends of a channel and the consuming entry', () => {
    expect(Object.keys(observed.joins)).toContain('producer:orders#src/orders/orders.service.ts:49:5 -emits-> channel:order.created');
    expect(observed.entries['entry:billing:event:order.created']?.hits).toBe(1);
    expect(observed.channels['channel:order.created']?.hits).toBe(2);
  });

  it('counts entry hits by method and route template, and symbols by Class.method', () => {
    expect(observed.entries['entry:billing:http:POST:/invoices']?.hits).toBe(1);
    expect(observed.entries['entry:billing:http:GET:/invoices/:param']?.hits).toBe(1);
    expect(observed.symbols['orders#src/orders/orders.service.ts:OrdersService.findOne']).toMatchObject({ hits: 1, max: 492 });
    // A span with no start or end is counted, without a duration (I3).
    expect(observed.symbols['table:orders#orders']).toMatchObject({ hits: 1 });
    expect(observed.symbols['table:orders#orders']).not.toHaveProperty('max');
  });

  it('lists what ran but is not in code', () => {
    expect(observed.unmatched.map(({ service, kind, name }) => `${service} ${kind} ${name}`)).toEqual([
      'billing client GET /orders/:value',
      'billing code LedgerClient.post',
      'billing db invoices',
      'billing http GET /healthz',
      'gateway http GET /metrics',
      'orders messaging order.audited',
    ]);
  });

  it('packs joins by edge position, entries by entry id, and ambiguous places by position for the page', () => {
    const entryIds = Object.fromEntries(
      graph.nodes.flatMap((node, index) => (node.type === 'entry' ? [[node.id, index]] : [])),
    );
    const position = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const packed = packObserved(observed, graph.edges, entryIds, position);
    const edge = graph.edges.findIndex(
      (item) => edgeIdOf(item) === 'producer:orders#src/orders/orders.service.ts:49:5 -emits-> channel:order.created',
    );
    expect(packed.joins[String(edge)]?.count).toBe(1);
    expect(unmatchedOf(packed)).toEqual(observed.unmatched.map(({ service, kind, name }) => ({ service, kind, name })));
    expect(packed.entries['entry:orders:http:POST:/orders']).toEqual({ hits: 1, p50: 35, p95: 35, max: 35, errors: 1, statuses: { '500': 1 } });
    expect(packed.window).toEqual({ from: '2025-10-16T07:00:00.000Z', to: '2025-10-16T08:00:00.000Z' });
    expect(ambiguousOf(packed)).toEqual([
      {
        service: 'gateway',
        kind: 'client',
        name: 'GET /orders/:value',
        count: 1,
        places: observed.ambiguous[0]!.candidates.map((id) => position.get(id)),
        unnamed: 0,
      },
    ]);
  });
});

describe('flowatlas observe, then visualise', () => {
  const dbPath = join(scratch, 'graph.db');
  const report = JSON.parse(readFileSync(join(fixture, 'expected.link-report.json'), 'utf8')) as LinkReport;
  writeGraphDb(graph, report, dbPath);
  const printed: string[] = [];
  const run = runObserve(traces, { db: dbPath, print: (line) => printed.push(line) });

  it('says what it did not read and what it could not single out', () => {
    expect(printed).toContain('not read: 1 snapshot of protocol ws, 1 node without o, c and m, 1 job without a span tree');
    expect(printed).toContain('could be more than one place, so counted on none:');
    expect(printed.some((line) => line.includes('any of http_out:gateway#src/clients/orders.client.ts:33:12'))).toBe(true);
  });

  it('writes a version-3 file core reads back', () => {
    expect(readObserved(run.path)).toEqual({ observed: run.observed });
  });

  it('lets no planted value reach the observed file or the page', () => {
    const file = readFileSync(run.path, 'utf8');
    for (const secret of PLANTED) expect(file).not.toContain(secret);
    const out = join(scratch, 'graph.html');
    runVisualise({ db: dbPath, out, print: () => {} });
    const page = readFileSync(out, 'utf8');
    const opening = '<script type="application/json" id="graph">';
    const start = page.indexOf(opening) + opening.length;
    const data = page.slice(start, page.indexOf('</script>', start));
    expect(JSON.parse(data).observed.ambiguous).toHaveLength(1);
    for (const secret of PLANTED) expect(data).not.toContain(secret);
  });
});

describe('matchSpans over the lambda-traces fixture (P107)', () => {
  const lambda = join(fixtures, 'lambda-traces');
  const lambdaGraph = JSON.parse(readFileSync(join(lambda, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  const trace = join(lambda, 'traces/adot.otlp.json');
  const { spans } = readTraceFiles([trace]);
  const observed = matchSpans(indexGraph(lambdaGraph.nodes, lambdaGraph.edges), spans);
  const STATES = 'shop#statemachine/fulfil-order.asl.json:fulfil-order';

  it('credits every function, the workflow and the route behind one checkout', () => {
    expect(Object.keys(observed.entries).sort()).toEqual([
      'entry:shop:event:dynamodb/orders',
      'entry:shop:http:POST:/checkout',
      'entry:shop:invoke:charge-card',
      // Named only by its ARN, through the alias it was invoked by.
      'entry:shop:invoke:checkout',
      'entry:shop:invoke:index-orders',
      'entry:shop:invoke:print-label',
      'entry:shop:invoke:reserve-stock',
      'entry:shop:invoke:ship-order',
      'entry:shop:workflow:fulfil-order',
    ]);
    expect(observed.entries['entry:shop:invoke:charge-card']).toMatchObject({ hits: 1, errors: 1, max: 270 });
  });

  it('counts every join the trace was written to run, on the side that called', () => {
    expect(Object.fromEntries(Object.entries(observed.joins).map(([id, seen]) => [id, [seen.count, seen.measuredAt]]))).toEqual({
      // The write and the send from checkout's own code, and the workflow it starts.
      'producer:shop#src/handlers/checkout.ts:15:9 -emits-> channel:dynamodb/orders': [1, 'caller'],
      'producer:shop#src/handlers/checkout.ts:16:9 -emits-> channel:sqs/order-placed': [1, 'caller'],
      'producer:shop#src/handlers/checkout.ts:17:9 -calls-> entry:shop:workflow:fulfil-order': [1, 'caller'],
      // Each step into the function its task invokes, the write onto the stream and the receipt.
      [`${STATES}/ReserveStock -calls-> entry:shop:invoke:reserve-stock`]: [1, 'caller'],
      [`${STATES}/ChargeCard -calls-> entry:shop:invoke:charge-card`]: [1, 'caller'],
      'producer:shop#statemachine/fulfil-order.asl.json:21:5 -emits-> channel:dynamodb/orders': [1, 'caller'],
      'producer:shop#statemachine/fulfil-order.asl.json:41:5 -emits-> channel:sns/receipts': [1, 'caller'],
      // The queue's message into ship-order, and ship-order's own invoke.
      'channel:sqs/order-placed -consumes-> consumer:shop#infra/main.tf:aws_lambda_event_source_mapping.ship_order': [1, 'callee'],
      'consumer:shop#infra/main.tf:aws_lambda_event_source_mapping.ship_order -calls-> entry:shop:invoke:ship-order': [1, 'callee'],
      'producer:shop#src/handlers/ship-order.ts:11:11 -calls-> entry:shop:invoke:print-label': [1, 'caller'],
      // The table's stream into index-orders, which leaves no message span of its own.
      'channel:dynamodb/orders -consumes-> consumer:shop#infra/main.tf:aws_lambda_event_source_mapping.index_orders': [1, 'callee'],
      'consumer:shop#infra/main.tf:aws_lambda_event_source_mapping.index_orders -triggers-> entry:shop:event:dynamodb/orders': [1, 'callee'],
    });
    expect(observed.ambiguous).toEqual([]);
  });

  it('credits the steps, the table and the call sites', () => {
    expect(Object.keys(observed.symbols).sort()).toEqual([
      'db_query:shop#statemachine/fulfil-order.asl.json:21:5',
      'producer:shop#src/handlers/checkout.ts:17:9',
      'producer:shop#src/handlers/ship-order.ts:11:11',
      `${STATES}/ChargeCard`,
      `${STATES}/MarkPaid`,
      `${STATES}/ReserveStock`,
      `${STATES}/SendReceipt`,
      'table:shop#orders',
    ]);
    // checkout's write, the step's write and ship-order's read.
    expect(observed.symbols['table:shop#orders']?.hits).toBe(3);
    expect(observed.channels).toMatchObject({
      'channel:dynamodb/orders': { hits: 3 },
      'channel:sqs/order-placed': { hits: 2 },
      'channel:sns/receipts': { hits: 1 },
    });
  });

  it('leaves only the two planted calls unmatched', () => {
    expect(observed.unmatched.map(({ service, kind, name, count }) => ({ service, kind, name, count }))).toEqual([
      { service: 'checkout', kind: 'cloud', name: 'SecretsManager/GetSecretValue', count: 1 },
      { service: 'checkout', kind: 'table', name: 'carts', count: 1 },
    ]);
  });

  it('keeps no ARN, account id, region or request parameter, in the spans or the file', () => {
    const planted = ['111122223333', 'eu-west-1', 'arn:', 'amazonaws', 'planted', 'PLANTED', 'promo'];
    for (const secret of planted) expect(JSON.stringify(spans)).not.toContain(secret);
    const out = mkdtempSync(join(scratch, 'lambda-'));
    const dbPath = join(out, 'graph.db');
    const report = JSON.parse(readFileSync(join(lambda, 'expected.link-report.json'), 'utf8')) as LinkReport;
    writeGraphDb(lambdaGraph, report, dbPath);
    const run = runObserve([trace], { db: dbPath, print: () => {} });
    const file = readFileSync(run.path, 'utf8');
    for (const secret of planted) expect(file).not.toContain(secret);
    expect(run.observed.privacy.kept).toEqual(expect.arrayContaining(['faas', 'workflow', 'state', 'tables', 'awsOp', 'transport']));
  });

  it('names a step the map does not have by its workflow only, in the row and in the sample', () => {
    const step = spans.find((span) => span.state === 'MarkPaid')!;
    const unknown = { ...step, state: 'RefundCustomerAcme7' };
    const seen = matchSpans(indexGraph(lambdaGraph.nodes, lambdaGraph.edges), spans.map((span) => (span === step ? unknown : span)));
    expect(seen.unmatched).toContainEqual(expect.objectContaining({ kind: 'state', name: 'fulfil-order/?', count: 1 }));
    expect(JSON.stringify(seen)).not.toContain('RefundCustomerAcme7');
    expect(JSON.stringify(seen.samples)).toContain('fulfil-order/?');
    expect(JSON.stringify(seen.samples)).toContain('fulfil-order/ReserveStock');
  });
});

describe('the AWS exports of the same traffic (P108)', () => {
  const lambda = join(fixtures, 'lambda-traces');
  const lambdaGraph = JSON.parse(readFileSync(join(lambda, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  const index = indexGraph(lambdaGraph.nodes, lambdaGraph.edges);
  const observedOf = (file: string, options = {}) => matchSpans(index, readTraceFiles([join(lambda, file)], undefined, options).spans);
  const otlp = observedOf('traces/adot.otlp.json');
  const hits = (observed: ReturnType<typeof matchSpans>) =>
    Object.fromEntries(Object.entries(observed.entries).map(([id, seen]) => [id, [seen.hits, seen.errors ?? 0]]));
  /** The OTLP trace's figures for the entries an export can see. */
  const otlpFor = (ids: readonly string[]) => Object.fromEntries(Object.entries(hits(otlp)).filter(([id]) => ids.includes(id)));
  const INVOKES = ['checkout', 'reserve-stock', 'charge-card', 'ship-order', 'print-label', 'index-orders'].map((fn) => `entry:shop:invoke:${fn}`);

  it('X-Ray gives every entry, join, step, table and channel the OTLP trace gives, and the same two unmatched calls', () => {
    const xray = observedOf('exports/xray.batch-get-traces.json');
    expect(hits(xray)).toEqual(hits(otlp));
    const counted = (rows: Record<string, { count?: number; hits?: number }>) =>
      Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, row.count ?? row.hits]));
    expect(counted(xray.joins)).toEqual(counted(otlp.joins));
    expect(counted(xray.symbols)).toEqual(counted(otlp.symbols));
    expect(counted(xray.channels)).toEqual(counted(otlp.channels));
    expect(xray.unmatched.map(({ kind, name }) => `${kind} ${name}`)).toEqual(otlp.unmatched.map(({ kind, name }) => `${kind} ${name}`));
    expect(xray.ambiguous).toEqual([]);
    expect(Object.keys(xray.samples).sort()).toEqual(Object.keys(otlp.samples).sort());
  });

  it("the execution history gives the workflow's run, its steps, and what each step's own task reaches", () => {
    const history = observedOf('exports/fulfil-order.history.json');
    expect(hits(history)).toEqual(otlpFor(['entry:shop:workflow:fulfil-order']));
    // A task's parameters are never read, so a step's call names no target;
    // the one target of its kind the step reaches on the map is credited (P110,
    // P108's open item), which is exactly what the OTLP trace gives the steps.
    const ofTheWorkflow = (id: string): boolean => id.includes('statemachine/fulfil-order.asl.json');
    expect(Object.keys(history.symbols).sort()).toEqual(Object.keys(otlp.symbols).filter(ofTheWorkflow).concat('table:shop#orders').sort());
    expect(Object.keys(history.joins).sort()).toEqual(Object.keys(otlp.joins).filter((id) => ofTheWorkflow(id.split(' ')[0]!)).sort());
    expect(Object.keys(history.channels).sort()).toEqual(['channel:dynamodb/orders', 'channel:sns/receipts']);
    expect(history.samples['entry:shop:workflow:fulfil-order']?.slow[0]).toMatchObject({ traceId: 'run-0001', ms: 825 });
    expect(history.unmatched).toEqual([]);
  });

  it('the access log gives the route, as entries and no joins, with no sample; REPORT lines give every function', () => {
    const log = observedOf('exports/checkout.access-log.jsonl');
    expect(hits(log)).toEqual(otlpFor(['entry:shop:http:POST:/checkout']));
    expect(log.joins).toEqual({});
    expect(log.samples).toEqual({});
    expect(log.unmatched.map(({ kind, name }) => `${kind} ${name}`)).toEqual(['http GET /favicon.ico']);
    for (const file of ['exports/report-lines.insights.json', 'exports/report-lines.insights.csv']) {
      const reports = observedOf(file);
      expect(hits(reports), file).toEqual(otlpFor(INVOKES));
      expect(reports.joins, file).toEqual({});
      expect(reports.samples, file).toEqual({});
      expect(reports.entries['entry:shop:invoke:charge-card'], file).toMatchObject({ max: 270, errors: 1 });
    }
  });

  it('says which format each file was, and keeps nothing account-, region- or request-shaped in the file', () => {
    const files = [
      'exports/xray.batch-get-traces.json',
      'exports/fulfil-order.history.json',
      'exports/checkout.access-log.jsonl',
      'exports/report-lines.insights.csv',
    ].map((file) => join(lambda, file));
    const out = mkdtempSync(join(scratch, 'exports-'));
    const dbPath = join(out, 'graph.db');
    writeGraphDb(lambdaGraph, JSON.parse(readFileSync(join(lambda, 'expected.link-report.json'), 'utf8')) as LinkReport, dbPath);
    const run = runObserve(files, { db: dbPath, print: () => {} });
    expect(Object.values(run.formats)).toEqual(['xray', 'sfn-history', 'apigw-access-log', 'lambda-report']);
    expect(run.observed.sources.map((source) => source.format)).toEqual(['xray', 'sfn-history', 'apigw-access-log', 'lambda-report']);
    expect(run.observed.privacy.kept).toContain('sampleable');
    const file = readFileSync(run.path, 'utf8');
    const planted = ['planted', '111122223333', 'eu-west-1', 'arn:', 'amazonaws', '203.0.113.7', 'k7x9q2w1ab', 'promo', 'Billed', 'XRAY'];
    for (const secret of planted) expect(file, secret).not.toContain(secret);
  });

  it('refuses a history or REPORT lines without the name they need, saying which flag gives it', () => {
    const bare = join(scratch, 'bare.history.json');
    writeFileSync(bare, JSON.stringify({ events: [{ id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: 1760603400 }] }));
    expect(() => readTraceFiles([bare])).toThrow(`${bare} names no state machine (merge describe-execution's stateMachineArn into it); name it with --workflow <name>`);
    expect(readTraceFiles([bare], undefined, { workflow: 'fulfil-order' }).formats).toEqual({ [bare]: 'sfn-history' });
    const plain = join(scratch, 'report.log');
    writeFileSync(plain, 'START RequestId: r1\nREPORT RequestId: r1\tDuration: 3.00 ms\nEND RequestId: r1\n');
    expect(() => readTraceFiles([plain])).toThrow(/report\.log has 1 REPORT line no log group names the function of; name it with --function <name>/);
    expect(readTraceFiles([plain], undefined, { function: 'checkout' }).spans).toHaveLength(1);
  });

  it('refuses a flag given for a format that does not take it', () => {
    const trace = join(lambda, 'traces/adot.otlp.json');
    expect(() => readTraceFiles([trace], undefined, { workflow: 'fulfil-order' })).toThrow(
      `--workflow applies to sfn-history files only; ${trace} is otlp`,
    );
    expect(() => readTraceFiles([join(lambda, 'exports/report-lines.insights.json')], undefined, { accessLogKeys: { route: 'rk' } })).toThrow(
      /--access-log-keys applies to apigw-access-log files only; .* is lambda-report/,
    );
    expect(() => runObserve([trace], { accessLogKeys: 'route=rk,colour=red', print: () => {} })).toThrow(/--access-log-keys takes <role>=<key> pairs/);
  });

  it('reads nothing from the network: no reader or the command imports a client', () => {
    const sources = ['readers/xray.ts', 'readers/sfn-history.ts', 'readers/apigw-access-log.ts', 'readers/lambda-report.ts', 'readers/log-records.ts', '../commands/observe.ts'];
    for (const source of sources) {
      const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), source), 'utf8');
      expect(text, source).not.toMatch(/node:(https?|net|dgram|tls)|fetch\(|@aws-sdk|XMLHttpRequest/);
    }
  });
});
