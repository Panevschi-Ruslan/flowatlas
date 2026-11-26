import { afterAll, describe, expect, it } from 'vitest';
import { buildTestDb, edge, entry, node, removeTestDbs } from '../test-graph.js';
import { findPath } from './path.js';
import type { FlowNode } from './types.js';

afterAll(removeTestDbs);

/** Each row as `label` or `label (again)`, indented by its depth. */
const lines = (row: FlowNode, depth = 0): string[] => [
  `${'  '.repeat(depth)}${row.node.label}${row.node.ref === true ? ' (again)' : ''}`,
  ...row.children.flatMap((child) => lines(child, depth + 1)),
];

/**
 * A way in whose handler reaches one table by two services, a guard nothing
 * walks through, and a request whose target could not be read.
 */
const db = buildTestDb({
  nodes: [
    entry('entry:web:http:POST:/checkout', { repo: 'web', label: 'POST /checkout', meta: { method: 'POST', path: '/checkout' } }),
    node('web#c.ts:Checkout.place', { repo: 'web', label: 'Checkout.place' }),
    node('web#s.ts:Stock.reserve', { repo: 'web', label: 'Stock.reserve' }),
    node('web#s.ts:Price.quote', { repo: 'web', label: 'Price.quote' }),
    node('web#s.ts:Store.write', { repo: 'web', label: 'Store.write' }),
    node('table:web#orders', { repo: 'web', type: 'table', label: 'orders' }),
    node('guard:web#Auth', { repo: 'web', type: 'guard', label: 'Auth' }),
    node('http_out:web#s.ts:9:1', { repo: 'web', type: 'http_out', label: 'POST /charge' }),
  ],
  edges: [
    edge('entry:web:http:POST:/checkout', 'web#c.ts:Checkout.place', { type: 'handles' }),
    edge('entry:web:http:POST:/checkout', 'guard:web#Auth', { type: 'guarded_by' }),
    edge('web#c.ts:Checkout.place', 'web#s.ts:Stock.reserve', { line: 3 }),
    edge('web#c.ts:Checkout.place', 'web#s.ts:Price.quote', { line: 4 }),
    edge('web#s.ts:Stock.reserve', 'web#s.ts:Store.write', { line: 5 }),
    edge('web#s.ts:Price.quote', 'web#s.ts:Store.write', { line: 6 }),
    edge('web#s.ts:Store.write', 'table:web#orders', { type: 'queries' }),
    edge('web#s.ts:Price.quote', 'http_out:web#s.ts:9:1', { line: 9 }),
  ],
  unresolved: [
    {
      service: 'web',
      file: 's.ts',
      line: 9,
      reason: 'target-route-not-found',
      message: 'no route POST /charge',
      symbol: 'http_out:web#s.ts:9:1',
    },
  ],
});

describe('how one node reaches another (P229)', () => {
  it('writes a node two shortest paths share once, and as a reference to it under the other', () => {
    const path = findPath(db, 'entry:web:http:POST:/checkout', 'table:web#orders');
    expect(path).toMatchObject({ found: true, length: 4, paths: 2, depth: 6, left: 0, unresolvedOnPath: 0 });
    expect(lines(path.root)).toEqual([
      'POST /checkout',
      '  Checkout.place',
      '    Stock.reserve',
      '      Store.write',
      '        orders',
      '    Price.quote',
      '      Store.write (again)',
    ]);
    const again = path.root.children[0]!.children[1]!.children[0]!;
    expect(again.node.seenAt).toBe('web#s.ts:Stock.reserve');
  });

  it('never walks a guard, which protects a step and is not one', () => {
    expect(findPath(db, 'entry:web:http:POST:/checkout', 'guard:web#Auth').found).toBe(false);
  });

  it('counts the nodes on the path something could not be read about', () => {
    expect(findPath(db, 'entry:web:http:POST:/checkout', 'http_out:web#s.ts:9:1').unresolvedOnPath).toBe(1);
  });

  it('says the other way round holds when asked the wrong way, and how far it looked', () => {
    const path = findPath(db, 'table:web#orders', 'entry:web:http:POST:/checkout');
    expect(path).toMatchObject({ found: false, length: null, paths: 0, depth: 24, searched: 1, reverse: { length: 4, paths: 2 } });
    expect(lines(path.root)).toEqual(['orders']);
  });

  it('walks either way when undirected, and then has no other way round to offer', () => {
    const path = findPath(db, 'table:web#orders', 'entry:web:http:POST:/checkout', { directed: false });
    expect(path).toMatchObject({ found: true, length: 4 });
    expect(path.reverse).toBeUndefined();
  });

  it('keeps one whole path when the node budget is smaller than the paths, and says how many it left', () => {
    const path = findPath(db, 'entry:web:http:POST:/checkout', 'table:web#orders', { maxNodes: 5 });
    expect(lines(path.root)).toEqual(['POST /checkout', '  Checkout.place', '    Price.quote', '      Store.write', '        orders']);
    expect(path.left).toBe(1);
  });

  it('looks only as far as a depth it is given', () => {
    expect(findPath(db, 'entry:web:http:POST:/checkout', 'table:web#orders', { depth: 3 })).toMatchObject({ found: false, depth: 3 });
  });
});
