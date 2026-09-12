import { describe, expect, it } from 'vitest';
import type { TypeEntry, TypeField, TypeRegistry } from '../model/types.js';
import { normalizeStructure, structuralHash } from './structural-hash.js';

const field = (name: string, type: string, optional = false): TypeField => ({
  name,
  type,
  optional,
});

const object = (name: string, fields: TypeField[], over: Partial<TypeEntry> = {}): TypeEntry => ({
  name,
  kind: 'object',
  declaredIn: 'orders#src/x.ts',
  structuralHash: '',
  fields,
  ...over,
});

const hash = (entry: TypeEntry, registry: TypeRegistry = {}): string =>
  structuralHash(entry, registry);

describe('structuralHash', () => {
  it('is the same for two types of the same shape with different names', () => {
    const one = object('Shape1', [field('id', 'string'), field('total', 'number')]);
    const two = object('Shape2', [field('id', 'string'), field('total', 'number')]);
    expect(hash(one)).toBe(hash(two));
  });

  it('does not depend on the order the fields were declared in', () => {
    const one = object('A', [field('a', 'string'), field('b', 'number')]);
    const two = object('A', [field('b', 'number'), field('a', 'string')]);
    expect(hash(one)).toBe(hash(two));
  });

  it('does not depend on where the type was declared', () => {
    const one = object('A', [field('a', 'string')]);
    const two = object('A', [field('a', 'string')], { declaredIn: 'billing#src/other.ts' });
    expect(hash(one)).toBe(hash(two));
  });

  it('changes when a field becomes optional', () => {
    const required = object('A', [field('a', 'string')]);
    const optional = object('A', [field('a', 'string', true)]);
    expect(hash(required)).not.toBe(hash(optional));
  });

  it('changes when a field type changes', () => {
    expect(hash(object('A', [field('a', 'string')]))).not.toBe(
      hash(object('A', [field('a', 'number')])),
    );
  });

  it('changes when a field is added', () => {
    expect(hash(object('A', [field('a', 'string')]))).not.toBe(
      hash(object('A', [field('a', 'string'), field('b', 'string')])),
    );
  });

  it('ignores annotations, which are a separate question', () => {
    const plain = object('A', [field('a', 'string')]);
    const annotated = object('A', [{ ...field('a', 'string'), meta: { validators: ['IsString'] } }]);
    expect(hash(plain)).toBe(hash(annotated));
  });

  it('reaches through a reference, so renaming a nested type changes nothing', () => {
    const first: TypeRegistry = {
      'type:orders#Item': object('Item', [field('sku', 'string')]),
      'type:orders#Cart': object('Cart', [field('items', 'type:orders#Item[]')]),
    };
    const second: TypeRegistry = {
      'type:orders#Article': object('Article', [field('sku', 'string')]),
      'type:orders#Cart': object('Cart', [field('items', 'type:orders#Article[]')]),
    };
    const a = first['type:orders#Cart'];
    const b = second['type:orders#Cart'];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(structuralHash(a, first)).toBe(structuralHash(b, second));
    }
  });

  it('notices when a nested type actually changes shape', () => {
    const before: TypeRegistry = {
      'type:orders#Item': object('Item', [field('sku', 'string')]),
      'type:orders#Cart': object('Cart', [field('items', 'type:orders#Item[]')]),
    };
    const after: TypeRegistry = {
      'type:orders#Item': object('Item', [field('sku', 'number')]),
      'type:orders#Cart': object('Cart', [field('items', 'type:orders#Item[]')]),
    };
    const a = before['type:orders#Cart'];
    const b = after['type:orders#Cart'];
    if (a !== undefined && b !== undefined) {
      expect(structuralHash(a, before)).not.toBe(structuralHash(b, after));
    }
  });

  it('terminates on a type that contains itself', () => {
    const registry: TypeRegistry = {
      'type:orders#Category': object('Category', [
        field('name', 'string'),
        field('children', 'type:orders#Category[]'),
      ]),
    };
    const entry = registry['type:orders#Category'];
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      const first = structuralHash(entry, registry);
      expect(first).toHaveLength(16);
      expect(structuralHash(entry, registry)).toBe(first);
      expect(normalizeStructure(entry, registry)).toContain('#cycle');
    }
  });

  it('terminates on two types that contain each other', () => {
    const registry: TypeRegistry = {
      'type:orders#A': object('A', [field('b', 'type:orders#B')]),
      'type:orders#B': object('B', [field('a', 'type:orders#A')]),
    };
    const a = registry['type:orders#A'];
    if (a !== undefined) expect(structuralHash(a, registry)).toHaveLength(16);
  });

  it('stops expanding at the depth given, and says so in the pre-image', () => {
    const registry: TypeRegistry = {
      'type:orders#L3': object('L3', [field('value', 'string')]),
      'type:orders#L2': object('L2', [field('next', 'type:orders#L3')]),
      'type:orders#L1': object('L1', [field('next', 'type:orders#L2')]),
      'type:orders#L0': object('L0', [field('next', 'type:orders#L1')]),
    };
    const entry = registry['type:orders#L0'];
    if (entry === undefined) throw new Error('fixture missing');
    expect(normalizeStructure(entry, registry, { maxDepth: 2 })).toContain('#ref');
    expect(normalizeStructure(entry, registry, { maxDepth: 9 })).not.toContain('#ref');
  });

  it('gives a type the same hash wherever it was first met', () => {
    const registry: TypeRegistry = {
      'type:orders#Leaf': object('Leaf', [field('v', 'string')]),
      'type:orders#Mid': object('Mid', [field('leaf', 'type:orders#Leaf')]),
      'type:orders#Top': object('Top', [field('mid', 'type:orders#Mid')]),
    };
    const leaf = registry['type:orders#Leaf'];
    if (leaf === undefined) throw new Error('fixture missing');
    // The hash of Leaf is taken from Leaf, never from the path that reached it.
    expect(structuralHash(leaf, registry)).toBe(structuralHash(leaf, {}));
  });

  it('identifies a type it did not read by where it came from', () => {
    const one: TypeEntry = {
      name: 'Request',
      kind: 'external',
      declaredIn: 'some-http-lib',
      structuralHash: '',
    };
    const same: TypeEntry = { ...one, meta: { anything: true } };
    const other: TypeEntry = { ...one, name: 'Response' };
    expect(hash(one)).toBe(hash(same));
    expect(hash(one)).not.toBe(hash(other));
    expect(normalizeStructure(one, {})).toBe('external:some-http-lib#Request');
  });

  it('hashes an enum by its values', () => {
    const entry: TypeEntry = {
      name: 'Status',
      kind: 'enum',
      declaredIn: 'orders#src/status.ts',
      structuralHash: '',
      members: ['NEW', 'PAID'],
    };
    const reordered: TypeEntry = { ...entry, members: ['PAID', 'NEW'], name: 'Other' };
    expect(hash(entry)).toBe(hash(reordered));
  });

  it('hashes a union by its members, in any order', () => {
    const entry: TypeEntry = {
      name: 'Kind',
      kind: 'union',
      declaredIn: 'orders#src/kind.ts',
      structuralHash: '',
      members: ["'a'", "'b'"],
    };
    const reordered: TypeEntry = { ...entry, members: ["'b'", "'a'"] };
    expect(hash(entry)).toBe(hash(reordered));
  });

  it('is a short hexadecimal string', () => {
    expect(hash(object('A', [field('a', 'string')]))).toMatch(/^[0-9a-f]{16}$/);
  });
});
