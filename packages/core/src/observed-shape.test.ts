import { describe, expect, it } from 'vitest';
import {
  isValueKey,
  mergeEntryShapes,
  mergeShapes,
  SHAPE_DEPTH,
  SHAPE_KEYS,
  SHAPE_OBJECTS,
  shapeAt,
  shapeOf,
  toTypeEntry,
  trafficTypeOf,
  type Shape,
} from './observed-shape.js';

/** Values of every JSON type, planted as values and as keys: none may survive in a shape. */
const PLANTED_VALUES = [
  'jane.doe@example.org',
  'ord-7731',
  'tok_live_9f8e7d',
  '6f1c2a9e-3b4d-4c5e-8f70-112233445566',
  '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
  'deadbeefcafebabefeedface',
  'hunter-pw-12',
  'gold-tier',
];
const PLANTED_NUMBERS = ['4242.17', '31337'];

const body = {
  id: 'ord-7731',
  owner: 'jane.doe@example.org',
  token: 'tok_live_9f8e7d',
  password: 'hunter-pw-12',
  tier: 'gold-tier',
  total: { amount: 4242.17, currency: 'EUR' },
  count: 31337,
  paid: true,
  note: null,
  tags: ['gold-tier', 'ord-7731'],
  byOrder: {
    'ord-7731': { qty: 1 },
    'jane.doe@example.org': { qty: 2 },
    '6f1c2a9e-3b4d-4c5e-8f70-112233445566': { qty: 3 },
    '9f8e7d6c5b4a39281706f5e4d3c2b1a0': { qty: 4, extra: 'tok_live_9f8e7d' },
    deadbeefcafebabefeedface: { qty: 5 },
  },
};

const expectNoValue = (shape: unknown): void => {
  const text = JSON.stringify(shape);
  for (const value of [...PLANTED_VALUES, ...PLANTED_NUMBERS]) expect(text, value).not.toContain(value);
  // No length either: the only numbers are counts of bodies.
  for (const n of text.match(/"n":\d+/g) ?? []) expect(n).toBe('"n":1');
};

describe('the value-like key rule (P113 D2)', () => {
  it('folds ids, emails, tokens, UUIDs and hex, and keeps names', () => {
    for (const key of ['ord-1', 'line2', 'a@b.org', 'x'.repeat(33), '6f1c2a9e-3b4d-4c5e-8f70-112233445566', 'deadbeefcafebabe', '']) {
      expect(isValueKey(key), key).toBe(true);
    }
    for (const key of ['id', 'customerId', 'total', '@type', 'created_at', 'face', 'x'.repeat(32)]) expect(isValueKey(key), key).toBe(false);
  });
});

describe('shapeOf (P113)', () => {
  const shape = shapeOf(body);

  it('keeps key names and JSON types only', () => {
    expect(shape.t).toBe('object');
    expect(Object.keys(shape.f!)).toEqual(['byOrder', 'count', 'id', 'note', 'owner', 'paid', 'password', 'tags', 'tier', 'token', 'total']);
    expect(shape.f!['count']!.s).toEqual({ t: 'number', n: 1 });
    expect(shape.f!['paid']!.s).toEqual({ t: 'boolean', n: 1 });
    expect(shape.f!['note']!.s).toEqual({ t: 'null', n: 1 });
    expect(shape.f!['tags']!.s).toEqual({ t: 'array', i: { t: 'string', n: 1 }, n: 1 });
    expect(shape.f!['total']!.s.f!['amount']!.s).toEqual({ t: 'number', n: 1 });
  });

  it('folds every value-like key into an index signature of the merged values', () => {
    const map = shape.f!['byOrder']!.s;
    expect(map.f).toBeUndefined();
    expect(map.idx).toEqual({
      t: 'object',
      n: 1,
      f: { extra: { s: { t: 'string', n: 1 }, n: 1, opt: true }, qty: { s: { t: 'number', n: 1 }, n: 1 } },
    });
  });

  it('holds no planted value, as a value or as a key, and no length', () => {
    expectNoValue(shape);
    expectNoValue(shapeOf([body, body, { ...body, extra: 'ord-7731' }]));
  });

  it('folds an object of more than SHAPE_KEYS keys wholly', () => {
    const wide = Object.fromEntries(Array.from({ length: SHAPE_KEYS + 1 }, (_, k) => [`key${String.fromCharCode(97 + Math.floor(k / 26))}${String.fromCharCode(97 + (k % 26))}`, k]));
    expect(shapeOf(wide)).toEqual({ t: 'object', idx: { t: 'number', n: 1 }, n: 1 });
  });

  it('stops at SHAPE_DEPTH and after SHAPE_OBJECTS objects, saying it was cut', () => {
    let deep: unknown = { leaf: 'x' };
    for (let k = 0; k < SHAPE_DEPTH + 2; k += 1) deep = { down: deep };
    let at: Shape | undefined = shapeOf(deep);
    let depth = 0;
    while (at?.f?.['down'] !== undefined) {
      at = at.f['down'].s;
      depth += 1;
    }
    expect(depth).toBe(SHAPE_DEPTH);
    expect(at).toEqual({ t: 'object', cut: true, n: 1 });
    const many = shapeOf(Array.from({ length: SHAPE_OBJECTS + 5 }, () => ({ a: 1 })));
    // The items past the budget were not walked, and say nothing against the ones that were.
    expect(many.i).toEqual({ t: 'object', f: { a: { s: { t: 'number', n: 1 }, n: 1 } }, n: 1 });
  });

  it('merges an array’s items within one body: a key some items lack is optional, counted once', () => {
    expect(shapeOf([{ a: 1, b: 'x' }, { a: 2 }])).toEqual({
      t: 'array',
      n: 1,
      i: { t: 'object', n: 1, f: { a: { s: { t: 'number', n: 1 }, n: 1 }, b: { s: { t: 'string', n: 1 }, n: 1, opt: true } } },
    });
    expect(shapeOf([])).toEqual({ t: 'array', n: 1 });
  });
});

describe('mergeShapes (P113)', () => {
  it('keeps a key every body carried required, the others optional with their count, differing types mixed', () => {
    const merged = [{ a: 1, b: 'x' }, { a: 2, c: true }, { a: 'three', b: 'y' }].map(shapeOf).reduce(mergeShapes);
    expect(merged).toEqual({
      t: 'object',
      n: 3,
      f: {
        a: { s: { t: 'mixed', ts: ['number', 'string'], n: 3 }, n: 3 },
        b: { s: { t: 'string', n: 2 }, n: 2, opt: true },
        c: { s: { t: 'boolean', n: 1 }, n: 1, opt: true },
      },
    });
  });

  it('keeps an object’s fields when the other body had null there, and a walked side over a cut one', () => {
    const merged = mergeShapes(shapeOf({ total: { amount: 1 } }), shapeOf({ total: null }));
    expect(merged.f!['total']!.s).toEqual({ t: 'mixed', ts: ['null', 'object'], n: 2, f: { amount: { s: { t: 'number', n: 1 }, n: 1 } } });
    const cut: Shape = { t: 'object', cut: true, n: 1 };
    expect(mergeShapes(cut, shapeOf({ a: 1 }))).toEqual({ t: 'object', n: 2, f: { a: { s: { t: 'number', n: 1 }, n: 1 } } });
  });

  it('merges a route’s shapes per status and counts its samples', () => {
    const a = { request: shapeOf({ a: 1 }), responses: { '200': shapeOf({ id: 'x' }) }, samples: 1, lastSeen: '2025-10-16T08:00:00.000Z' };
    const b = { responses: { '404': shapeOf({ message: 'x' }) }, samples: 2, lastSeen: '2025-10-16T09:00:00.000Z' };
    expect(mergeEntryShapes(a, b)).toEqual({
      request: a.request,
      responses: { '200': a.responses['200'], '404': b.responses['404'] },
      samples: 3,
      lastSeen: '2025-10-16T09:00:00.000Z',
    });
  });

  it('finds the shape at a dotted path, through arrays', () => {
    const shape = shapeOf({ items: [{ price: 1 }], total: { amount: 2 } });
    expect(shapeAt(shape, 'items[].price')).toEqual({ t: 'number', n: 1 });
    expect(shapeAt(shape, 'total.amount')).toEqual({ t: 'number', n: 1 });
    expect(shapeAt(shape, 'total.missing')).toBeUndefined();
  });
});

describe('a shape as a type (P113)', () => {
  it('is an object entry declared in traffic, nested objects by traffic id, optional where some body lacked it', () => {
    const shape = [{ id: 'a', total: { amount: 1 } }, { id: 'b', note: null }].map(shapeOf).reduce(mergeShapes);
    const into = {};
    const entry = toTypeEntry(shape, 'request', into);
    expect(entry).toMatchObject({ kind: 'object', declaredIn: 'traffic' });
    expect(entry.fields).toEqual([
      { name: 'id', type: 'string', optional: false },
      { name: 'note', type: 'null', optional: true },
      { name: 'total', type: 'type:traffic#T2', optional: true },
    ]);
    expect(into).toHaveProperty(['type:traffic#T2', 'fields'], [{ name: 'amount', type: 'number', optional: false }]);
  });

  it('writes arrays, unions, maps and objects it could not see into as references', () => {
    expect(trafficTypeOf(shapeOf([1, 'x']), 'body').ref).toBe('(number | string)[]');
    expect(trafficTypeOf(shapeOf({ 'ord-1': 1 }), 'body').ref).toBe('Record<string, number>');
    expect(trafficTypeOf(shapeOf({}), 'body').ref).toBe('object');
    expect(trafficTypeOf(shapeOf([]), 'body').ref).toBe('unknown[]');
    const { ref, types } = trafficTypeOf(shapeOf({ id: 'x', 'ord-1': 2 }), 'body');
    expect(types[ref]?.meta).toEqual({ indexSignature: 'number' });
  });
});
