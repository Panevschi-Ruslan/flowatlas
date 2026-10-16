import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readTraceFiles } from '../commands/observe.js';
import { packObserved } from '../visualise/observed.js';
import { edgeIdOf, indexGraph, matchSpans, routeScore, templateOf } from './match.js';
import { nestjsObserveReader, otlpReader, readerFor } from './readers.js';
import { pathOf } from './span.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const traces = [join(fixture, 'traces/checkout.otlp.json'), join(fixture, 'traces/billing.observe.json')];

describe('trace readers', () => {
  it('picks the reader by sniffing the document', () => {
    expect(readerFor({ resourceSpans: [] })).toBe(otlpReader);
    expect(readerFor([{ ti: 't', p: '/x' }])).toBe(nestjsObserveReader);
    expect(readerFor({ something: 'else' })).toBeUndefined();
  });

  it('drops values: headers, user ids, queries, statements and ids in a path', () => {
    const { spans, formats } = readTraceFiles(traces);
    expect(Object.values(formats)).toEqual(['otlp', 'nestjs-observe']);
    const text = JSON.stringify(spans);
    for (const secret of ['not-a-real-token', 'user-7781', 's3cr3t', 'ord-1042', 'ord-1043', 'cus-311', 'inv-9001', '_id']) {
      expect(text).not.toContain(secret);
    }
    expect(pathOf('http://h/orders/ord-1042?x=1')).toBe('/orders/:value');
    expect(pathOf('/orders/latest')).toBe('/orders/latest');
  });

  it('reads the @nestjs/observe span tree as Class.method symbols under a server span', () => {
    const spans = nestjsObserveReader.read(JSON.parse(readFileSync(traces[1]!, 'utf8')));
    expect(spans[0]).toMatchObject({ kind: 'server', method: 'POST', route: '/invoices', service: 'billing' });
    expect(spans.map((span) => span.symbol).filter(Boolean)).toContain('InvoicesService.create');
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
  const observed = matchSpans(indexGraph(graph.nodes, graph.edges), readTraceFiles(traces).spans);

  it('confirms the cross-service HTTP join from parent and child spans', () => {
    expect(
      observed.joins['http_out:gateway#src/clients/orders.client.ts:33:12 -http_calls-> entry:orders:http:GET:/orders/:param'],
    ).toEqual({ count: 1, lastSeen: '2025-10-16T07:33:20.001Z' });
  });

  it('confirms both ends of a channel and the consuming entry', () => {
    expect(Object.keys(observed.joins)).toContain('producer:orders#src/orders/orders.service.ts:49:5 -emits-> channel:order.created');
    expect(observed.entries['entry:billing:event:order.created']?.hits).toBe(1);
    expect(observed.channels['channel:order.created']?.hits).toBe(2);
  });

  it('counts entry hits by method and route template, and symbols by Class.method', () => {
    expect(observed.entries['entry:billing:http:POST:/invoices']?.hits).toBe(1);
    expect(observed.entries['entry:billing:http:GET:/invoices/:param']?.hits).toBe(1);
    expect(observed.symbols['orders#src/orders/orders.service.ts:OrdersService.findOne']).toEqual({ hits: 1 });
    expect(observed.symbols['table:orders#Order']).toEqual({ hits: 1 });
  });

  it('lists what ran but is not in code', () => {
    expect(observed.unmatched).toEqual([
      { service: 'billing', kind: 'code', name: 'LedgerClient.post', count: 1 },
      { service: 'gateway', kind: 'http', name: 'GET /metrics', count: 1 },
      { service: 'orders', kind: 'messaging', name: 'order.audited', count: 1 },
    ]);
  });

  it('packs joins by edge position and entries by entry id for the page', () => {
    const entryIds = Object.fromEntries(
      graph.nodes.flatMap((node, index) => (node.type === 'entry' ? [[node.id, index]] : [])),
    );
    const packed = packObserved(observed, graph.edges, entryIds);
    const position = graph.edges.findIndex(
      (edge) => edgeIdOf(edge) === 'producer:orders#src/orders/orders.service.ts:49:5 -emits-> channel:order.created',
    );
    expect(packed.joins[String(position)]?.count).toBe(1);
    expect(packed.entries['entry:orders:http:POST:/orders']).toEqual({ hits: 1 });
    expect(packed.unmatched[0]).toEqual({ service: 'billing', kind: 'code', name: 'LedgerClient.post' });
  });
});
