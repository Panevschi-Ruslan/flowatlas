import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphEdge, GraphNode, ProjectGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { PLANTED } from './__fixtures__/planted.js';
import { indexGraph, matchSpans } from './match.js';
import { otlpReader, readerFor } from './readers.js';
import type { ObservedSpan } from './span.js';
import { zipkinReader } from './zipkin-reader.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const load = (file: string): unknown => JSON.parse(readFileSync(join(fixture, 'traces', file), 'utf8'));
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const byId = (spans: readonly ObservedSpan[]): ObservedSpan[] =>
  [...spans].sort((a, b) => `${a.traceId}/${a.spanId}`.localeCompare(`${b.traceId}/${b.spanId}`));

/** Planted in the Zipkin export beside the OTLP file's: endpoints' addresses, an annotation, a statement tag. */
const ZIPKIN_PLANTED = ['198.51.100', 'wire send', 'secret-stmt-8', 'remoteEndpoint', 'annotations'];

describe('the Zipkin v2 reader (P112)', () => {
  const zipkin = load('checkout.zipkin.json');
  const otlp = otlpReader.read(load('checkout.otlp.json'));
  const read = zipkinReader.read(zipkin);

  it('recognises a list of spans and a list of traces, and nothing else', () => {
    expect(readerFor(zipkin)).toBe(zipkinReader);
    expect(readerFor((zipkin as unknown[][]).flat())).toBe(zipkinReader);
    expect(readerFor([{ traceId: 't', id: 's' }])).toBeUndefined();
    expect(readerFor([{ traceId: 't', name: 'x', timestamp: 1 }])).toBeUndefined();
    expect(readerFor([])).toBeUndefined();
  });

  it('gives the spans the OTLP file of the same traffic gives', () => {
    expect(byId(read.spans)).toEqual(byId(otlp.spans));
  });

  it('gives the same observed file over the fixture graph', () => {
    const index = indexGraph(graph.nodes, graph.edges);
    const now = new Date('2025-10-16T09:00:00.000Z');
    expect(matchSpans(index, read.spans, { now })).toEqual(matchSpans(index, otlp.spans, { now }));
  });

  it('reads Brave’s names, the error tag as true and a span without a duration', () => {
    const { spans } = zipkinReader.read([
      {
        traceId: 't',
        id: 's',
        kind: 'SERVER',
        timestamp: 1_000_000,
        localEndpoint: { serviceName: 'shop', ipv4: '10.0.0.1' },
        tags: { 'http.method': 'get', 'http.path': '/cart/ord-55', 'http.status_code': '503', error: 'boom at a secret place' },
      },
    ]);
    expect(spans).toEqual([
      { traceId: 't', spanId: 's', kind: 'server', service: 'shop', method: 'GET', path: '/cart/:value', at: '1970-01-01T00:00:01.000Z', status: 503, error: true },
    ]);
  });

  it('takes --service when a span names no endpoint, and an absent kind as internal', () => {
    const { spans } = zipkinReader.read([{ traceId: 't', id: 's', timestamp: 5_000, tags: { 'code.function.name': 'Cart.add' } }], 'shop');
    expect(spans).toEqual([{ traceId: 't', spanId: 's', kind: 'internal', service: 'shop', symbol: 'Cart.add', at: '1970-01-01T00:00:00.005Z' }]);
  });

  it('copies no name, annotation, endpoint, statement, header or error text, and counts what it dropped', () => {
    const text = JSON.stringify(read);
    for (const secret of [...PLANTED, ...ZIPKIN_PLANTED]) expect(text).not.toContain(secret);
    expect(read.droppedAttributes).toBeGreaterThan(10);
  });
});
