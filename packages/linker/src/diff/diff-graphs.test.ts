import { describe, expect, it } from 'vitest';
import { diffGraphs, impactedNodes } from './diff-graphs.js';
import { lostJoins } from './lost-joins.js';
import { graphDiffSchema, parseGraphDiff } from './schema.js';
import { edge, field, graphOf, node, object } from './test-graph.js';
import { DIFF_FORMAT_VERSION, sectionsMissing } from './types.js';

describe('diffGraphs', () => {
  it('names a node that appeared and one that went away', () => {
    const base = graphOf({ nodes: [node('orders#a.ts:A.one'), node('orders#a.ts:A.gone')] });
    const head = graphOf({ nodes: [node('orders#a.ts:A.one'), node('orders#a.ts:A.new')] });

    const diff = diffGraphs(base, head);

    expect(diff.nodes.added).toEqual(['orders#a.ts:A.new']);
    expect(diff.nodes.removed).toEqual(['orders#a.ts:A.gone']);
    expect(diff.nodes.changed).toEqual([]);
    expect(diff.nodes.moved).toEqual([]);
  });

  it('calls a node whose only delta is its line moved, never changed', () => {
    const base = graphOf({ nodes: [node('orders#a.ts:A.one', 'method', { line: 12 })] });
    const head = graphOf({ nodes: [node('orders#a.ts:A.one', 'method', { line: 17 })] });

    const diff = diffGraphs(base, head);

    expect(diff.nodes.moved).toEqual(['orders#a.ts:A.one']);
    expect(diff.nodes.changed).toEqual([]);
  });

  it('names which fields of a changed node differ, meta key by meta key', () => {
    const base = graphOf({
      nodes: [node('orders#a.ts:A.one', 'method', { line: 12, meta: { order: 1, note: 'x' } })],
    });
    const head = graphOf({
      nodes: [
        node('orders#a.ts:A.one', 'method', { line: 40, label: 'renamed', meta: { order: 2, note: 'x' } }),
      ],
    });

    const [changed] = diffGraphs(base, head).nodes.changed;

    expect(changed?.fields).toEqual(['label', 'meta.order']);
    // Moved as well as changed, and the line is deliberately not a field: a
    // reviewer reading `fields` is reading what the revision did.
    expect(changed?.fields).not.toContain('line');
    expect(diffGraphs(base, head).nodes.moved).toEqual([]);
  });

  it('keys an edge by from, type and to, so a moved call site is not a change', () => {
    const base = graphOf({
      edges: [edge('a', 'b', { file: 'src/a.ts', line: 3 })],
    });
    const head = graphOf({
      edges: [edge('a', 'b', { file: 'src/a.ts', line: 90 })],
    });

    const diff = diffGraphs(base, head);

    expect(diff.edges.added).toEqual([]);
    expect(diff.edges.removed).toEqual([]);
    expect(diff.edges.changed).toEqual([]);
  });

  it('reports a weakened edge as changed and names the field', () => {
    const base = graphOf({ edges: [edge('a', 'b', { confidence: 'static' })] });
    const head = graphOf({ edges: [edge('a', 'b', { confidence: 'heuristic' })] });

    const [changed] = diffGraphs(base, head).edges.changed;

    expect(changed?.key).toBe('a|calls|b');
    expect(changed?.fields).toEqual(['confidence']);
  });

  it('tells two edges between the same pair apart by their type', () => {
    const base = graphOf({ edges: [edge('a', 'b', { type: 'calls' })] });
    const head = graphOf({
      edges: [edge('a', 'b', { type: 'calls' }), edge('a', 'b', { type: 'injects' })],
    });

    const diff = diffGraphs(base, head);

    expect(diff.edges.added).toEqual([{ from: 'a', to: 'b', type: 'injects' }]);
    expect(diff.edges.removed).toEqual([]);
  });

  it('decides a type changed by its structural hash, not by its name', () => {
    const before = object('CreateOrderDto', [field('id', 'string')]);
    const after = object('CreateOrderDto', [field('id', 'string'), field('channel', 'string')]);
    const base = graphOf({ types: { 'type:orders#CreateOrderDto': before } });
    const head = graphOf({ types: { 'type:orders#CreateOrderDto': after } });

    const [changed] = diffGraphs(base, head).types.changed;

    expect(changed?.id).toBe('type:orders#CreateOrderDto');
    expect(changed?.baseHash).toBe(before.structuralHash);
    expect(changed?.headHash).toBe(after.structuralHash);
    expect(changed?.baseHash).not.toBe(changed?.headHash);
  });

  it('says a required field appeared, in the words a reviewer reads', () => {
    const base = graphOf({
      types: { 'type:orders#CreateOrderDto': object('CreateOrderDto', [field('id', 'string')]) },
    });
    const head = graphOf({
      types: {
        'type:orders#CreateOrderDto': object('CreateOrderDto', [
          field('id', 'string'),
          field('channel', 'string'),
        ]),
      },
    });

    const [changed] = diffGraphs(base, head).types.changed;

    expect(changed?.fieldDiff).toHaveLength(1);
    expect(changed?.fieldDiff[0]?.field).toBe('channel');
    expect(changed?.fieldDiff[0]?.change).toBe('added');
    expect(changed?.fieldDiff[0]?.optional).toBe(false);
    expect(changed?.fieldDiff[0]?.message).toContain('head declares `channel`');
  });

  it('says a field went away, without calling it a new one', () => {
    const base = graphOf({
      types: {
        'type:orders#CreateOrderDto': object('CreateOrderDto', [
          field('id', 'string'),
          field('legacy', 'string'),
        ]),
      },
    });
    const head = graphOf({
      types: { 'type:orders#CreateOrderDto': object('CreateOrderDto', [field('id', 'string')]) },
    });

    const [changed] = diffGraphs(base, head).types.changed;

    expect(changed?.fieldDiff.map((row) => [row.field, row.change])).toEqual([['legacy', 'removed']]);
  });

  it('lets the wire rules decide: a Date that became a string is not a field change', () => {
    // The hash differs — the declarations really are different — and the field
    // diff is empty, because JSON carries a Date as a string either way. This
    // is the one place `diff` and `contracts` must agree, and they agree by
    // using the same comparator.
    const base = graphOf({
      types: { 'type:orders#OrderDto': object('OrderDto', [field('at', 'Date')]) },
    });
    const head = graphOf({
      types: { 'type:orders#OrderDto': object('OrderDto', [field('at', 'string')]) },
    });

    const [changed] = diffGraphs(base, head).types.changed;

    expect(changed?.baseHash).not.toBe(changed?.headHash);
    expect(changed?.fieldDiff).toEqual([]);
  });

  it('takes a comparator of its own, for a caller with other rules', () => {
    const base = graphOf({
      types: { 'type:orders#OrderDto': object('OrderDto', [field('at', 'Date')]) },
    });
    const head = graphOf({
      types: { 'type:orders#OrderDto': object('OrderDto', [field('at', 'string')]) },
    });

    const diff = diffGraphs(base, head, { compareTypes: () => [] });

    expect(diff.types.changed).toHaveLength(1);
    expect(diff.types.changed[0]?.fieldDiff).toEqual([]);
  });

  it('names a type that appeared and one that went away', () => {
    const base = graphOf({ types: { 'type:orders#Gone': object('Gone', []) } });
    const head = graphOf({ types: { 'type:orders#New': object('New', []) } });

    const diff = diffGraphs(base, head);

    expect(diff.types.added).toEqual(['type:orders#New']);
    expect(diff.types.removed).toEqual(['type:orders#Gone']);
  });

  it('puts every list in a fixed order, whatever order the graphs were in', () => {
    const nodes = ['orders#c.ts:C.one', 'orders#a.ts:A.one', 'orders#b.ts:B.one'];
    const head = graphOf({
      nodes: nodes.map((id) => node(id)),
      edges: [edge('z', 'y'), edge('a', 'b'), edge('m', 'n')],
    });
    const shuffled = graphOf({
      nodes: [...nodes].reverse().map((id) => node(id)),
      edges: [edge('m', 'n'), edge('a', 'b'), edge('z', 'y')],
    });

    const one = diffGraphs(graphOf(), head);
    const two = diffGraphs(graphOf(), shuffled);

    expect(one.nodes.added).toEqual(['orders#a.ts:A.one', 'orders#b.ts:B.one', 'orders#c.ts:C.one']);
    expect(one.nodes.added).toEqual(two.nodes.added);
    expect(one.edges.added).toEqual(two.edges.added);
  });

  it('counts both sides, rows and sites apart, since a row can stand for many', () => {
    const base = graphOf({
      nodes: [node('a')],
      unresolved: [{ file: 'a.ts', line: 1, reason: 'call-dynamic-receiver', level: 'info', sites: 170 }],
    });
    const head = graphOf({
      nodes: [node('a'), node('b')],
      unresolved: [
        { file: 'a.ts', line: 1, reason: 'call-dynamic-receiver', level: 'info', sites: 171 },
        { file: 'b.ts', line: 2, reason: 'dynamic-http-url' },
      ],
    });

    const diff = diffGraphs(base, head);

    expect(diff.counts.base.unresolved).toEqual({ rows: 1, sites: 170 });
    expect(diff.counts.head.unresolved).toEqual({ rows: 2, sites: 172 });
    expect(diff.counts.head.nodes).toBe(2);
  });

  it('asks about what changed and what went, never about what appeared', () => {
    const base = graphOf({ nodes: [node('kept'), node('gone')] });
    const head = graphOf({
      nodes: [node('kept', 'method', { label: 'renamed' }), node('fresh')],
    });

    expect(impactedNodes(diffGraphs(base, head))).toEqual([
      { id: 'kept', side: 'head' },
      { id: 'gone', side: 'base' },
    ]);
  });
});

describe('gaps by gap id (P96)', () => {
  const METHOD = 'orders#src/refunds.ts:RefundsService.issue';
  const row = (over: Record<string, unknown>) => ({ service: 'orders', file: 'src/refunds.ts', line: 10, reason: 'call-dynamic-receiver', level: 'info', ...over }) as never;

  it('names each gap id the head has and the base does not, in the method its first row is in', () => {
    const base = graphOf({ nodes: [node(METHOD)], unresolved: [row({ reason: 'channel-dynamic', line: 4 })] });
    const head = graphOf({
      nodes: [node(METHOD)],
      unresolved: [
        row({ line: 12, symbol: `RefundsService.issue -> this.steps[kind]`, sites: 2 }),
        row({ line: 30, sites: 1 }),
      ],
    });

    const diff = diffGraphs(base, head);

    expect(diff.unresolved.added).toEqual([
      {
        id: 'gap:orders|src/refunds.ts|call-dynamic-receiver',
        kind: 'gap',
        service: 'orders',
        file: 'src/refunds.ts',
        line: 12,
        reason: 'call-dynamic-receiver',
        node: METHOD,
        sites: 3,
      },
    ]);
    expect(diff.unresolved.removed.map((ref) => ref.id)).toEqual(['gap:orders|src/refunds.ts|channel-dynamic']);
  });

  it('keeps findings apart from gaps and leaves notes and places with nothing to draw out', () => {
    const head = graphOf({
      unresolved: [
        row({ reason: 'query-in-loop' }),
        row({ reason: 'base-url-from-files', file: 'src/client.ts' }),
        row({ reason: 'call-dynamic-receiver', level: 'nothing', file: 'src/view.ts' }),
      ],
    });

    const added = diffGraphs(graphOf(), head).unresolved.added;

    expect(added.map((ref) => [ref.reason, ref.kind])).toEqual([['query-in-loop', 'finding']]);
  });

  it('says nothing about a gap id both sides have, however its rows moved', () => {
    const base = graphOf({ unresolved: [row({ line: 10 })] });
    const head = graphOf({ unresolved: [row({ line: 90 }), row({ line: 91 })] });

    expect(diffGraphs(base, head).unresolved).toEqual({ added: [], removed: [] });
  });
});

describe('lostJoins (P96)', () => {
  const CALL = 'http_out:gateway#src/clients/orders.client.ts:26:12';
  const ROUTE = 'entry:orders:http:GET:/shipments/:param';
  const RENAMED = 'entry:orders:http:GET:/shipments/:param/status';
  const gateway = { repo: 'gateway' };

  it('names a request that joined a route and joins nothing now, with what the head side says instead', () => {
    const base = graphOf({
      nodes: [node(CALL, 'http_out', gateway), node(ROUTE, 'entry')],
      edges: [edge(CALL, ROUTE, { type: 'http_calls' })],
    });
    const head = graphOf({
      nodes: [node(CALL, 'http_out', gateway), node(RENAMED, 'entry')],
      unresolved: [{ service: 'gateway', file: 'src/clients/orders.client.ts', line: 26, reason: 'target-route-not-found', symbol: CALL }],
    });

    expect(lostJoins(base, head)).toEqual([
      {
        kind: 'target-gone',
        caller: CALL,
        target: ROUTE,
        edge: 'http_calls',
        service: 'gateway',
        targetService: 'orders',
        now: 'target-route-not-found',
        targetRemoved: true,
      },
    ]);
    expect(diffGraphs(base, head).joins.lost).toHaveLength(1);
  });

  it('is quiet about a request removed with its caller, and about one that joins another route now', () => {
    const base = graphOf({
      nodes: [node(CALL, 'http_out', gateway), node(ROUTE, 'entry')],
      edges: [edge(CALL, ROUTE, { type: 'http_calls' })],
    });
    expect(lostJoins(base, graphOf({ nodes: [node(ROUTE, 'entry')] }))).toEqual([]);
    const retargeted = graphOf({
      nodes: [node(CALL, 'http_out', gateway), node(RENAMED, 'entry')],
      edges: [edge(CALL, RENAMED, { type: 'http_calls' })],
    });
    expect(lostJoins(base, retargeted)).toEqual([]);
  });

  it('says no-edge where the head side wrote nothing about the caller', () => {
    const base = graphOf({
      nodes: [node(CALL, 'http_out', gateway), node(ROUTE, 'entry')],
      edges: [edge(CALL, ROUTE, { type: 'hits' })],
    });
    const head = graphOf({ nodes: [node(CALL, 'http_out', gateway), node(ROUTE, 'entry')] });

    expect(lostJoins(base, head)).toEqual([expect.objectContaining({ edge: 'hits', now: 'no-edge', targetRemoved: false })]);
  });

  it('names the consumers left on a channel that lost its last producer, and the producers left on one that lost its last consumer', () => {
    const channel = 'channel:order.created';
    const producer = 'producer:orders#src/orders.service.ts:20:5';
    const consumer = 'consumer:billing#src/invoices.consumer.ts:InvoicesConsumer.on';
    const both = graphOf({
      nodes: [node(channel, 'channel', { repo: '' }), node(producer, 'producer'), node(consumer, 'consumer', { repo: 'billing' })],
      edges: [edge(producer, channel, { type: 'emits' }), edge(channel, consumer, { type: 'consumes' })],
    });
    const noProducer = graphOf({
      nodes: [node(channel, 'channel', { repo: '' }), node(consumer, 'consumer', { repo: 'billing' })],
      edges: [edge(channel, consumer, { type: 'consumes' })],
    });
    const noConsumer = graphOf({
      nodes: [node(channel, 'channel', { repo: '' }), node(producer, 'producer')],
      edges: [edge(producer, channel, { type: 'emits' })],
    });

    expect(lostJoins(both, noProducer)).toEqual([
      expect.objectContaining({ kind: 'no-producer', caller: consumer, target: channel, service: 'billing', now: 'no-producer' }),
    ]);
    expect(lostJoins(both, noConsumer)).toEqual([
      expect.objectContaining({ kind: 'no-consumer', caller: producer, target: channel, service: 'orders' }),
    ]);
    // Gone whole: nobody is left to notice.
    expect(lostJoins(both, graphOf())).toEqual([]);
  });
});

describe('diff.json formats (P96)', () => {
  const formatOne = {
    diffFormatVersion: 1,
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    base: { ref: 'main', services: {} },
    head: { ref: null, services: {} },
    nodes: { added: [], removed: [], changed: [], moved: [] },
    edges: { added: [], removed: [], changed: [] },
    types: { added: [], removed: [], changed: [] },
    counts: {
      base: { nodes: 0, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } },
      head: { nodes: 0, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } },
    },
    impact: [],
    contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
    warnings: [],
    timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
  };

  it('writes format 2, with the gaps and the lost joins', () => {
    expect(DIFF_FORMAT_VERSION).toBe(2);
    const current = { ...formatOne, diffFormatVersion: 2, unresolved: { added: [], removed: [] }, joins: { lost: [] } };
    expect(graphDiffSchema.parse(current).diffFormatVersion).toBe(2);
    expect(() => graphDiffSchema.parse(formatOne)).toThrow();
  });

  it('still reads format 1, its new sections empty and said to be missing', () => {
    const read = parseGraphDiff(formatOne);
    expect(read.diffFormatVersion).toBe(1);
    expect(read.unresolved).toEqual({ added: [], removed: [] });
    expect(read.joins).toEqual({ lost: [] });
    expect(sectionsMissing(read)).toEqual(['unresolved', 'joins']);
    expect(sectionsMissing({ diffFormatVersion: 2 })).toEqual([]);
  });

  it('refuses a format from a newer flowatlas by name, and a document with no format', () => {
    expect(() => parseGraphDiff({ ...formatOne, diffFormatVersion: 9 })).toThrow(/format 9, written by a newer flowatlas/);
    expect(() => parseGraphDiff({})).toThrow(/no diffFormatVersion/);
    // A format-1 document is still checked as one: a typo is an error, not a default.
    expect(() => parseGraphDiff({ ...formatOne, extra: true })).toThrow();
  });
});
