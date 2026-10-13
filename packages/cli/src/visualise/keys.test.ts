import { describe, expect, it } from 'vitest';
import { KEY_WIDTH, stableKeys, type Digest } from './keys.js';

const keyOf = (packed: ReturnType<typeof stableKeys>, i: number): string =>
  packed.longer[String(i)] ?? packed.all.slice(i * packed.width, (i + 1) * packed.width);

/** A digest that spells what it is told to, so a collision can be arranged. */
const scripted =
  (spelled: Record<string, number[]>): Digest =>
  (id) =>
    Uint8Array.from(spelled[id] ?? []);

describe('a short key for every node', () => {
  const ids = [
    'entry:api:http:GET:/orders',
    'db:api#src/orders.repo.ts:7',
    'method:api:OrdersService.list',
    'table:orders',
  ];

  it('is six characters, a letter first, then letters and digits', () => {
    const packed = stableKeys(ids);
    expect(packed.width).toBe(KEY_WIDTH);
    expect(packed.all).toHaveLength(ids.length * KEY_WIDTH);
    for (let i = 0; i < ids.length; i += 1) expect(keyOf(packed, i)).toMatch(/^[a-z][a-z0-9]{5}$/);
  });

  it('depends on the id alone, so a rebuild with nodes added and removed keeps it', () => {
    const before = stableKeys(ids);
    const after = stableKeys(['aaa:first', ids[3]!, 'method:api:New.thing', ids[0]!, ids[2]!]);
    expect(keyOf(after, 1)).toBe(keyOf(before, 3));
    expect(keyOf(after, 3)).toBe(keyOf(before, 0));
    expect(keyOf(after, 4)).toBe(keyOf(before, 2));
  });

  it('is different for every node of a real-sized graph', () => {
    const many = Array.from({ length: 12_000 }, (_, i) => `method:svc:Class${i}.member${i % 7}`);
    const packed = stableKeys(many);
    const seen = new Set(many.map((_, i) => keyOf(packed, i)));
    expect(seen.size).toBe(many.length);
  });

  it('gives neither of two ids that spell the same key that key, but a longer one each', () => {
    const digest = scripted({
      'b:second': [0, 1, 2, 3, 4, 5, 9, 9],
      'a:first': [0, 1, 2, 3, 4, 5, 7, 7],
      'c:alone': [1, 1, 1, 1, 1, 1, 1, 1],
    });
    const packed = stableKeys(['b:second', 'a:first', 'c:alone'], { digest });
    expect(keyOf(packed, 0)).toBe('a123459');
    expect(keyOf(packed, 1)).toBe('a123457');
    expect(keyOf(packed, 2)).toBe('b11111');
    expect(packed.longer).toEqual({ 0: 'a123459', 1: 'a123457' });
    // The short key they share stays in place, so the page can name both.
    expect(packed.all.slice(0, 12)).toBe('a12345a12345');
  });

  it('keeps a key whatever order the ids come in', () => {
    const digest = scripted({ p: [0, 1, 2, 3, 4, 5, 1], q: [0, 1, 2, 3, 4, 5, 2] });
    const one = stableKeys(['p', 'q'], { digest });
    const other = stableKeys(['q', 'p'], { digest });
    expect([keyOf(one, 0), keyOf(one, 1)]).toEqual([keyOf(other, 1), keyOf(other, 0)]);
  });

  it('spells as many more characters as three ids sharing a key take to differ', () => {
    const digest = scripted({
      x1: [0, 0, 0, 0, 0, 0, 0, 0, 1],
      x2: [0, 0, 0, 0, 0, 0, 0, 0, 2],
      x3: [0, 0, 0, 0, 0, 0, 0, 5, 3],
    });
    const packed = stableKeys(['x3', 'x2', 'x1'], { digest });
    const keys = [0, 1, 2].map((i) => keyOf(packed, i));
    expect(keys).toEqual(['a0000005', 'a00000002', 'a00000001']);
  });

  it('refuses two nodes with the same id, which no key could tell apart', () => {
    expect(() => stableKeys(['same', 'same'])).toThrow(/same key/);
  });

  it('takes a narrower width when asked, and still tells every node apart', () => {
    const many = Array.from({ length: 400 }, (_, i) => `node:${i}`);
    const packed = stableKeys(many, { width: 2 });
    expect(Object.keys(packed.longer).length).toBeGreaterThan(0);
    expect(new Set(many.map((_, i) => keyOf(packed, i))).size).toBe(many.length);
  });
});
