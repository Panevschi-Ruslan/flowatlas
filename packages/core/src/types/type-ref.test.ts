import { describe, expect, it } from 'vitest';
import {
  formatTypeRef,
  idsOfTypeRef,
  isPrimitiveName,
  parseTypeRef,
  TypeRefParseError,
  type TypeRefAst,
} from './type-ref.js';

const ROUND_TRIP = [
  'string',
  'number',
  'boolean',
  'Date',
  'Buffer',
  'void',
  'any',
  'unknown',
  'never',
  'null',
  'undefined',
  "'draft'",
  '42',
  'true',
  'string[]',
  'string[][]',
  'type:orders#Order',
  'type:orders#Order[]',
  'type:@fixture/contracts#SharedOrderEvent',
  'type:orders#Paginated<type:orders#Order>',
  'type:orders#Paginated<type:orders#Order,number>',
  'string|number',
  'string|null|undefined',
  'type:orders#A&type:orders#B',
  '(string|number)[]',
  '[string,number]',
  '[]',
  'Record<string,type:orders#Order>',
  'Map<string,number>',
  'Set<type:orders#Order>',
  '{id:string;name?:string}',
  '{}',
  '{items:type:orders#Item[];total:number}',
  '{nested:{deep:string}}',
  "'a'|'b'",
];

describe('parseTypeRef and formatTypeRef', () => {
  it.each(ROUND_TRIP)('round-trips %s', (ref) => {
    expect(formatTypeRef(parseTypeRef(ref))).toBe(ref);
  });

  it('reads a primitive', () => {
    expect(parseTypeRef('string')).toEqual({ kind: 'primitive', name: 'string' });
  });

  it('reads a registry reference with its arguments separated', () => {
    expect(parseTypeRef('type:orders#Paginated<type:orders#Order>')).toEqual({
      kind: 'id',
      id: 'type:orders#Paginated',
      args: [{ kind: 'id', id: 'type:orders#Order' }],
    });
  });

  it('reads an inline object with optional fields', () => {
    expect(parseTypeRef('{id:string;note?:number}')).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', optional: false, type: { kind: 'primitive', name: 'string' } },
        { name: 'note', optional: true, type: { kind: 'primitive', name: 'number' } },
      ],
    });
  });

  it('reads a union of literals', () => {
    expect(parseTypeRef("'a'|'b'")).toEqual({
      kind: 'union',
      members: [
        { kind: 'literal', value: 'a' },
        { kind: 'literal', value: 'b' },
      ],
    });
  });

  it('keeps an array of a union grouped', () => {
    const ast = parseTypeRef('(string|number)[]');
    expect(ast.kind).toBe('array');
    expect(formatTypeRef(ast)).toBe('(string|number)[]');
  });

  it('refuses text it cannot read', () => {
    expect(() => parseTypeRef('{id string}')).toThrow(TypeRefParseError);
    expect(() => parseTypeRef('string|')).toThrow(TypeRefParseError);
  });

  it('knows which names are primitives', () => {
    expect(isPrimitiveName('string')).toBe(true);
    expect(isPrimitiveName('Order')).toBe(false);
  });
});

describe('idsOfTypeRef', () => {
  it('collects every reference at any depth', () => {
    const ids = idsOfTypeRef(
      parseTypeRef('{a:type:orders#A[];b:Record<string,type:orders#B>;c:type:orders#P<type:orders#C>}'),
    );
    expect(ids.sort()).toEqual([
      'type:orders#A',
      'type:orders#B',
      'type:orders#C',
      'type:orders#P',
    ]);
  });

  it('finds nothing in a reference made only of primitives', () => {
    expect(idsOfTypeRef(parseTypeRef('{a:string;b:number[]}'))).toEqual([]);
  });
});

/**
 * The writer against the reader, over shapes nobody chose.
 *
 * Every example above is a shape somebody thought of, which is exactly why the
 * bug this guards against survived: nobody thought of an object key spelled
 * `<=`, and the reader refused one the writer had just emitted. So this
 * generates references from the grammar, asks the writer for the text, and holds
 * the reader to reading that text back — the same text, the same tree. The
 * alphabet the keys are drawn from is the grammar's own punctuation, because the
 * only keys worth generating are the ones that collide with it.
 */
describe('what the writer writes, the reader reads', () => {
  /**
   * A small deterministic generator, so a failure is a failure again tomorrow.
   *
   * A seeded sequence rather than `Math.random`: a property test that cannot be
   * re-run on the case it failed on is a test that reports a mystery.
   */
  const sequence = (seed: number) => {
    let state = seed >>> 0;
    return (bound: number): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % bound;
    };
  };

  /** Keys a real dependency declares, and the punctuation of this grammar. */
  const KEYS = [
    'id',
    'a.b',
    'content-type',
    '<',
    '<=',
    '>=',
    '!!',
    '*',
    '$in',
    'and',
    '?',
    ':',
    ';',
    '|',
    '&',
    '{}',
    '[]',
    '()',
    ',',
    '',
    ' ',
    'two words',
    "it's",
    'back\\slash',
    "'quoted'",
    'tab\there',
  ];

  /**
   * Names written verbatim, kept clear of the spellings the writer gives other
   * nodes: a name of `true`, one that begins with a digit or a quote, or one
   * holding punctuation is not a name this format can write bare, and writing
   * one would be testing the generator rather than the round trip.
   */
  const NAMES = ['string', 'number', 'Order', 'Money', 'AnonymousShape'];
  const IDS = ['type:orders#Order', 'type:@fx/contracts#Money'];

  const next = sequence(20260926);
  const pick = <T>(values: readonly T[]): T => values[next(values.length)] as T;

  /**
   * One reference, to a bounded depth.
   *
   * Unions and intersections are generated only with members that are neither,
   * and only outside one another, because the writer flattens them: `a|(b|c)`
   * and `a|b|c` are one piece of text, so a nested one would be a case where
   * the tree differs and the text does not — a property of the format rather
   * than a defect in it.
   */
  const anyRef = (depth: number, flat = false): TypeRefAst => {
    const leaves: Array<() => TypeRefAst> = [
      () => ({ kind: 'primitive', name: pick(NAMES) }),
      () => ({ kind: 'literal', value: pick(KEYS) }),
      () => ({ kind: 'literal', value: next(1000) }),
      () => ({ kind: 'literal', value: next(2) === 0 }),
      () => ({ kind: 'id', id: pick(IDS) }),
    ];
    if (depth <= 0) return (pick(leaves) as () => TypeRefAst)();

    const branches: Array<() => TypeRefAst> = [
      ...leaves,
      () => ({ kind: 'array', element: anyRef(depth - 1) }),
      () => ({ kind: 'tuple', elements: [anyRef(depth - 1), anyRef(depth - 1)] }),
      () => ({ kind: 'generic', name: pick(NAMES), args: [anyRef(depth - 1)] }),
      () => ({ kind: 'id', id: pick(IDS), args: [anyRef(depth - 1)] }),
      () => ({
        kind: 'object',
        fields: Array.from({ length: 1 + next(3) }, () => ({
          name: pick(KEYS),
          optional: next(2) === 0,
          type: anyRef(depth - 1),
        })),
      }),
    ];
    if (!flat) {
      branches.push(
        () => ({ kind: 'union', members: [anyRef(depth - 1, true), anyRef(depth - 1, true)] }),
        () => ({ kind: 'intersection', members: [anyRef(depth - 1, true), anyRef(depth - 1, true)] }),
      );
    }
    return (pick(branches) as () => TypeRefAst)();
  };

  it('reads back every reference it writes, tree and text alike', () => {
    for (let round = 0; round < 2000; round += 1) {
      const ast = anyRef(4);
      const text = formatTypeRef(ast);
      // Both halves of the round trip, because either alone can pass while the
      // format is broken: matching text with a different tree means the reader
      // guessed, and a matching tree written differently means the text on disk
      // is not what the writer would write again.
      expect(() => parseTypeRef(text), text).not.toThrow();
      const read = parseTypeRef(text);
      expect(read, text).toEqual(ast);
      expect(formatTypeRef(read), text).toBe(text);
    }
  });

  it('reads back a key that is not a name, as it was written', () => {
    // The case from the field, spelled out rather than left to the generator: a
    // dependency declaring JsonLogic operators as keys used to stop every
    // command that parses a reference.
    for (const key of ['<', '<=', '!!', '*', '', "it's", 'two words']) {
      const ast: TypeRefAst = {
        kind: 'object',
        fields: [{ name: key, optional: false, type: { kind: 'primitive', name: 'number' } }],
      };
      const text = formatTypeRef(ast);
      expect(parseTypeRef(text), text).toEqual(ast);
    }
  });
});
