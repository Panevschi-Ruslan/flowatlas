import { describe, expect, it } from 'vitest';
import { diffGraphs, impactedNodes } from './diff-graphs.js';
import { edge, field, graphOf, node, object } from './test-graph.js';

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
