import { describe, expect, it } from 'vitest';
import {
  formatTypeRef,
  idsOfTypeRef,
  isPrimitiveName,
  parseTypeRef,
  TypeRefParseError,
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
