import { describe, expect, it } from 'vitest';
import { buildTestDb, node } from '../analysis/__fixtures__/test-db.js';
import { explainSelection, resolveSelector, selectionHint } from './selector.js';

const route = (service: string, method: string, path: string) =>
  node(`entry:${service}:http:${method}:${path}`, {
    type: 'entry',
    kind: 'http',
    repo: service,
    label: `${method} ${path}`,
    meta: { method, path },
  });

const db = buildTestDb({
  nodes: [
    route('gateway', 'POST', '/orders'),
    route('orders', 'POST', '/orders'),
    route('orders', 'GET', '/orders/:param'),
    route('billing', 'POST', '/invoices'),
  ],
  edges: [],
});

describe('working out which entry someone means', () => {
  it('takes an id as it stands', () => {
    const found = resolveSelector(db, 'entry:billing:http:POST:/invoices');
    expect(found).toMatchObject({ kind: 'one', id: 'entry:billing:http:POST:/invoices' });
  });

  it('matches a route named with a real id in the hole', () => {
    const found = resolveSelector(db, 'GET /orders/12345');
    expect(found).toMatchObject({ kind: 'one', id: 'entry:orders:http:GET:/orders/:param' });
  });

  it('refuses to pick when two services serve the same route, and names both', () => {
    const found = resolveSelector(db, 'POST /orders');
    expect(found.kind).toBe('several');
    expect(explainSelection('POST /orders', found)).toEqual([
      '"POST /orders" matches 2 entries:',
      '  entry:gateway:http:POST:/orders',
      '  entry:orders:http:POST:/orders',
    ]);
    expect(selectionHint(found)).toContain('Name one of them exactly');
  });

  it('offers the nearest entries when nothing matches', () => {
    const found = resolveSelector(db, 'invoices');
    expect(found.kind).toBe('none');
    expect(explainSelection('invoices', found)).toEqual([
      'no entry matches "invoices"',
      'Closest entries:',
      '  entry:billing:http:POST:/invoices',
    ]);
  });

  it('says where to look when nothing is even close', () => {
    const found = resolveSelector(db, 'zzz');
    expect(explainSelection('zzz', found)).toEqual(['no entry matches "zzz"']);
    expect(selectionHint(found)).toContain('flowatlas dead --kind entries');
  });
});
