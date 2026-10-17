import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphEdge, GraphNode, ProjectGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { indexGraph, matchSpans } from './match.js';
import { otlpReader } from './readers/index.js';
import type { ObservedSpan } from './span.js';
import { TraceBuffer } from './trace-buffer.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo');

const spansOf = (traceId: string, n: number): ObservedSpan[] =>
  Array.from({ length: n }, (_, at) => ({ traceId, spanId: `${traceId}-${at}`, kind: 'internal' as const }));

const traceIds = (traces: ObservedSpan[][]): string[] => traces.map((trace) => trace[0]!.traceId);

describe('TraceBuffer', () => {
  it('lets the trace least recently added to go first when it would hold too many spans', () => {
    const buffer = new TraceBuffer({ waitMs: 1_000, maxSpans: 5 });
    expect(buffer.add(spansOf('a', 2), 0)).toEqual([]);
    expect(buffer.add(spansOf('b', 2), 1)).toEqual([]);
    // `a` is added to again, so `b` is now the oldest.
    expect(buffer.add([{ traceId: 'a', spanId: 'a-9', kind: 'internal' }], 2)).toEqual([]);
    const out = buffer.add(spansOf('c', 2), 3);
    expect(traceIds(out)).toEqual(['b']);
    expect(buffer.cutShort).toBe(1);
    expect(buffer.spans).toBe(5);
    expect(buffer.size).toBe(2);
  });

  it('holds at most so many traces', () => {
    const buffer = new TraceBuffer({ waitMs: 1_000, maxTraces: 2 });
    buffer.add(spansOf('a', 1), 0);
    buffer.add(spansOf('b', 1), 0);
    expect(traceIds(buffer.add(spansOf('c', 1), 0))).toEqual(['a']);
    expect(buffer.size).toBe(2);
    expect(buffer.cutShort).toBe(1);
  });

  it('lets a trace that alone is over the bound go at once, whole', () => {
    const buffer = new TraceBuffer({ waitMs: 1_000, maxSpans: 3 });
    const out = buffer.add(spansOf('big', 4), 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4);
    expect(buffer.spans).toBe(0);
  });

  it('hands a trace back once nothing was added to it for the wait, and keeps the ones still filling', () => {
    const buffer = new TraceBuffer({ waitMs: 100 });
    buffer.add(spansOf('a', 1), 0);
    buffer.add(spansOf('b', 1), 50);
    buffer.add([{ traceId: 'a', spanId: 'a-late', kind: 'internal' }], 60);
    expect(buffer.expired(120)).toEqual([]);
    expect(traceIds(buffer.expired(150))).toEqual(['b']);
    const late = buffer.expired(160);
    expect(late[0]!.map((span) => span.spanId)).toEqual(['a-0', 'a-late']);
    expect(buffer.size).toBe(0);
    expect(buffer.cutShort).toBe(0);
  });

  it('drains everything, oldest first', () => {
    const buffer = new TraceBuffer({ waitMs: 1_000 });
    buffer.add(spansOf('a', 1), 0);
    buffer.add(spansOf('b', 2), 1);
    expect(traceIds(buffer.drain())).toEqual(['a', 'b']);
    expect(buffer.spans).toBe(0);
  });

  it('matches a trace whose spans came in two posts as one read over both does', () => {
    const graph = JSON.parse(readFileSync(join(fixture, 'expected.project-graph.json'), 'utf8')) as ProjectGraph & {
      nodes: GraphNode[];
      edges: GraphEdge[];
    };
    const index = indexGraph(graph.nodes, graph.edges);
    const document = JSON.parse(readFileSync(join(fixture, 'traces/checkout.otlp.json'), 'utf8')) as {
      resourceSpans: unknown[];
    };
    const whole = otlpReader.read(document).spans;
    // Each service's spans in a post of their own, as each exporter sends them.
    const buffer = new TraceBuffer({ waitMs: 1_000 });
    for (const resourceSpans of document.resourceSpans) buffer.add(otlpReader.read({ resourceSpans: [resourceSpans] }).spans, 0);
    const now = new Date('2025-10-16T09:00:00.000Z');
    const together = matchSpans(index, buffer.drain().flat(), { now });
    const once = matchSpans(index, whole, { now });
    expect(together.joins).toEqual(once.joins);
    expect(Object.keys(once.joins).length).toBeGreaterThan(0);
    // Matched a post at a time, the cross-service joins are never seen.
    const alone = document.resourceSpans.map((resourceSpans) =>
      matchSpans(index, otlpReader.read({ resourceSpans: [resourceSpans] }).spans, { now }),
    );
    const joinsAlone = new Set(alone.flatMap((run) => Object.keys(run.joins)));
    expect(joinsAlone.size).toBeLessThan(Object.keys(once.joins).length);
  });
});
