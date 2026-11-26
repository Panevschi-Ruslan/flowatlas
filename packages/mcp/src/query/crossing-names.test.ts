import { afterAll, describe, expect, it } from 'vitest';
import { buildTestDb, edge, entry, node, removeTestDbs } from '../test-graph.js';
import { crossingNamesOf } from './crossing-names.js';

afterAll(removeTestDbs);

/**
 * P396: on a real five-repository project `build` wrote no `edits.json`, and
 * the try around it said nothing. A body sent across repositories whose type
 * is made of itself (`type Json = string | Json[]`) walked the shape forever
 * and overflowed the stack; the names are read now, and the build says any
 * failure that is left.
 */
describe('the names an edit could break elsewhere', () => {
  it('reads a body whose type is made of itself, never walking it forever', () => {
    const route = 'entry:orders:http:POST:/orders';
    const handler = 'orders#src/orders.controller.ts:OrdersController.create';
    const caller = 'http_out:web#src/api.ts:4:2';
    const db = buildTestDb({
      nodes: [
        entry(route, { label: 'POST /orders', file: 'src/orders.controller.ts', line: 7, meta: { method: 'POST', path: '/orders' } }),
        node(handler, { file: 'src/orders.controller.ts', line: 8, meta: { fieldsRead: [{ field: 'note', line: 9 }] } }),
        node(caller, { type: 'http_out', label: 'POST /orders', repo: 'web', file: 'src/api.ts', line: 4 }),
        node('web#src/api.ts:sendOrder', { type: 'function', label: 'sendOrder', repo: 'web', file: 'src/api.ts', line: 3 }),
      ],
      edges: [
        edge(route, handler, { type: 'handles' }),
        edge('web#src/api.ts:sendOrder', caller),
        edge(caller, route, { type: 'http_calls', file: 'src/api.ts', line: 4, params: ['type:web#Json'] }),
      ],
      types: {
        'type:web#Json': { name: 'Json', kind: 'union', declaredIn: 'web#src/api.ts', structuralHash: 'json', members: ['type:web#Json', 'string'] },
      } as never,
    });
    const names = crossingNamesOf(db);
    // The route still crosses: the caller in another repository is named.
    expect(names.find((name) => name.kind === 'route')?.users).toEqual(['web sendOrder (src/api.ts:4)']);
    // The body's shape is not known, so no field is said on either end.
    expect(names.filter((name) => name.kind === 'field')).toEqual([]);
  });
});
