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
import { nestjsObserveReader, otlpReader, readerFor } from './readers.js';
import { pathOf } from './span.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
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
