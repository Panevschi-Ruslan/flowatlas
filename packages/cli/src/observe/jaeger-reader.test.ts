import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphEdge, GraphNode, ProjectGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { PLANTED } from './__fixtures__/planted.js';
import { indexGraph, matchSpans } from './match.js';
import { otlpReader, readerFor } from './readers.js';
import type { ObservedSpan } from './span.js';
import { jaegerReader } from './jaeger-reader.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');
const load = (file: string): unknown => JSON.parse(readFileSync(join(fixture, 'traces', file), 'utf8'));
const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
const byId = (spans: readonly ObservedSpan[]): ObservedSpan[] =>
  [...spans].sort((a, b) => `${a.traceId}/${a.spanId}`.localeCompare(`${b.traceId}/${b.spanId}`));

/** Planted in the Jaeger export beside the OTLP file's: process tags, warnings, log fields. */
const JAEGER_PLANTED = ['198.51.100', '-host-h7', 'Go-2.30.0', 'clock skew', 'otel.status_description', 'exception'];

describe('the Jaeger reader (P112)', () => {
  const jaeger = load('checkout.jaeger.json');
  const otlp = otlpReader.read(load('checkout.otlp.json'));
  const read = jaegerReader.read(jaeger);

  it('recognises the UI’s download and a trace on its own, and nothing else', () => {
    expect(readerFor(jaeger)).toBe(jaegerReader);
    const [trace] = (jaeger as { data: unknown[] }).data;
    expect(readerFor(trace)).toBe(jaegerReader);
    expect(readerFor({ data: [] })).toBeUndefined();
    expect(readerFor({ data: [{ traceID: 't' }] })).toBeUndefined();
  });

  it('gives the spans the OTLP file of the same traffic gives', () => {
    expect(byId(read.spans)).toEqual(byId(otlp.spans));
  });

  it('gives the same observed file over the fixture graph', () => {
    const index = indexGraph(graph.nodes, graph.edges);
    const now = new Date('2025-10-16T09:00:00.000Z');
    expect(matchSpans(index, read.spans, { now })).toEqual(matchSpans(index, otlp.spans, { now }));
  });

  it('takes the first CHILD_OF parent, bool and int64 tags as values, and a span without a process from --service', () => {
    const { spans } = jaegerReader.read(
      {
        traceID: 't',
        spans: [
          {
            traceID: 't',
            spanID: 's',
            references: [
              { refType: 'FOLLOWS_FROM', traceID: 't', spanID: 'f' },
              { refType: 'CHILD_OF', traceID: 't', spanID: 'p1' },
              { refType: 'CHILD_OF', traceID: 't', spanID: 'p2' },
            ],
            startTime: 2_000_000,
            duration: 1500,
            tags: [
              { key: 'span.kind', type: 'string', value: 'client' },
              { key: 'http.method', type: 'string', value: 'POST' },
              { key: 'http.url', type: 'string', value: 'https://catalog.example.test/items/42?x=1' },
              { key: 'http.status_code', type: 'int64', value: 502 },
              { key: 'error', type: 'bool', value: true },
              { key: 'peer.address', type: 'string', value: '10.1.2.3' },
            ],
            logs: [{ timestamp: 2_000_100, fields: [{ key: 'message', type: 'string', value: 'a secret line' }] }],
          },
          { traceID: 't', spanID: 'g', references: [{ refType: 'FOLLOWS_FROM', spanID: 's' }], tags: [] },
        ],
      },
      'shop',
    );
    expect(spans).toEqual([
      {
        traceId: 't',
        spanId: 's',
        parentId: 'p1',
        kind: 'client',
        service: 'shop',
        method: 'POST',
        path: '/items/:value',
        at: '1970-01-01T00:00:02.000Z',
        status: 502,
        durationMs: 1.5,
        error: true,
      },
      { traceId: 't', spanId: 'g', parentId: 's', kind: 'internal', service: 'shop' },
    ]);
    expect(JSON.stringify(spans)).not.toContain('secret');
  });

  it('copies no operation name, log, warning, process tag, statement, header or status text, and counts what it dropped', () => {
    const text = JSON.stringify(read);
    for (const secret of [...PLANTED, ...JAEGER_PLANTED]) expect(text).not.toContain(secret);
    expect(read.droppedAttributes).toBeGreaterThan(10);
  });
});
