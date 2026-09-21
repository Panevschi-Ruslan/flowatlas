import type { TypeEntry, TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { compareTypes, diffTypes } from './compare.js';
import type { FieldDiff } from './types.js';
import { field, object, values } from './test-graph.js';

/**
 * The comparator, on two shapes and nothing else.
 *
 * Every verdict the tool ever gives comes out of this file, so each case here
 * is one claim about what a difference between two declarations means, written
 * so that a failure names the claim.
 */

const kinds = (diffs: readonly FieldDiff[]): string[] =>
  diffs.map((diff) => `${diff.kind} ${diff.path}`);

describe('the four kinds of disagreement', () => {
  it('calls a field the receiver requires and the sender omits missing_required', () => {
    const sender = object('A', [field('id', 'string')]);
    const receiver = object('B', [field('id', 'string'), field('channel', 'string')]);
    expect(kinds(compareTypes(sender, receiver, {}))).toEqual(['missing_required channel']);
  });

  it('says nothing when the field the sender omits is optional', () => {
    const sender = object('A', [field('id', 'string')]);
    const receiver = object('B', [field('id', 'string'), field('channel', 'string', true)]);
    expect(compareTypes(sender, receiver, {})).toEqual([]);
  });

  it('calls a field both declare differently type_mismatch', () => {
    const sender = object('A', [field('total', 'string')]);
    const receiver = object('B', [field('total', 'number')]);
    const [diff] = compareTypes(sender, receiver, {});
    expect(diff?.kind).toBe('type_mismatch');
    expect(diff?.expected).toBe('number');
    expect(diff?.actual).toBe('string');
  });

  it('calls one side optional and the other required optionality_mismatch, either way round', () => {
    const loose = object('A', [field('note', 'string', true)]);
    const strict = object('B', [field('note', 'string')]);
    expect(compareTypes(loose, strict, {})[0]).toMatchObject({
      kind: 'optionality_mismatch',
      optionalOn: 'sender',
    });
    expect(compareTypes(strict, loose, {})[0]).toMatchObject({
      kind: 'optionality_mismatch',
      optionalOn: 'receiver',
    });
  });

  it('calls a field only the sender has extra_field', () => {
    const sender = object('A', [field('id', 'string'), field('debugId', 'string')]);
    const receiver = object('B', [field('id', 'string')]);
    expect(kinds(compareTypes(sender, receiver, {}))).toEqual(['extra_field debugId']);
  });
});

describe('compatibility runs one way', () => {
  it('accepts a narrower value where a wider one is declared', () => {
    const sender = object('A', [field('ok', 'true'), field('status', "'paid'")]);
    const receiver = object('B', [field('ok', 'boolean'), field('status', 'string')]);
    expect(compareTypes(sender, receiver, {})).toEqual([]);
  });

  it('refuses a wider value where a narrower one is declared', () => {
    const sender = object('A', [field('status', 'string')]);
    const receiver = object('B', [field('status', "'paid'|'unpaid'")]);
    expect(kinds(compareTypes(sender, receiver, {}))).toEqual(['type_mismatch status']);
  });

  it('reads `true|false` as the boolean it is', () => {
    const sender = object('A', [field('ok', 'boolean')]);
    const receiver = object('B', [field('ok', 'true|false')]);
    expect(compareTypes(sender, receiver, {})).toEqual([]);
  });

  it('says nothing about a field neither side makes a claim about', () => {
    const sender = object('A', [field('extras', 'any')]);
    const receiver = object('B', [field('extras', 'type:x#Thing')]);
    expect(compareTypes(sender, receiver, {})).toEqual([]);
  });
});

describe('named sets of values', () => {
  const registry = {
    'type:a#Status': values('Status', 'enum', ['new', 'paid', 'shipped']),
    'type:b#Status': values('Status', 'union', ["'new'", "'paid'"]),
  };

  it('reads an enum and the union that spells it out as the same set', () => {
    const wide = { ...registry, 'type:b#Status': values('Status', 'union', ["'new'", "'paid'", "'shipped'"]) };
    const sender = object('A', [field('status', 'type:a#Status')], wide);
    const receiver = object('B', [field('status', 'type:b#Status')], wide);
    expect(compareTypes(sender, receiver, wide)).toEqual([]);
  });

  it('names the values the receiver does not accept', () => {
    const sender = object('A', [field('status', 'type:a#Status')], registry);
    const receiver = object('B', [field('status', 'type:b#Status')], registry);
    const [diff] = compareTypes(sender, receiver, registry);
    expect(diff?.kind).toBe('type_mismatch');
    expect(diff?.message).toContain("'shipped' is not among the values the receiver accepts");
  });
});

describe('nesting', () => {
  const registry = {
    'type:a#Item': object('Item', [field('price', 'number')]),
    'type:b#Item': object('Item', [field('price', 'string')]),
  };

  it('writes the path through an array as `items[].price`', () => {
    const sender = object('A', [field('items', 'type:a#Item[]')], registry);
    const receiver = object('B', [field('items', 'type:b#Item[]')], registry);
    expect(kinds(compareTypes(sender, receiver, registry))).toEqual(['type_mismatch items[].price']);
  });

  it('reads a shape written out in place like a named one', () => {
    const sender = object('A', [field('at', '{city:string}')]);
    const receiver = object('B', [field('at', '{city:number}')]);
    expect(kinds(compareTypes(sender, receiver, {}))).toEqual(['type_mismatch at.city']);
  });

  it('merges what an intersection contributes', () => {
    const registryWith = { 'type:a#Base': object('Base', [field('id', 'string')]) };
    const sender = object('A', [field('at', 'type:a#Base&{extra:string}')], registryWith);
    const receiver = object('B', [field('at', '{id:string;extra:string}')], registryWith);
    expect(compareTypes(sender, receiver, registryWith)).toEqual([]);
  });
});

describe('a mismatch of the whole type', () => {
  it('is one finding at the root and not one per field (D7)', () => {
    const sender = values('Status', 'union', ["'a'", "'b'"]);
    const receiver = object('B', [field('id', 'string'), field('name', 'string')]);
    const diffs = compareTypes(sender, receiver, {});
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.path).toBe('');
    expect(diffs[0]?.message).toContain('a union cannot stand in for a object');
  });
});

describe('depth and cycles', () => {
  // Built from the leaf up, so each level's hash actually reaches through the
  // one below it. Built the other way round, every level hashes over a
  // placeholder and the two chains come out looking alike.
  const chain = (repo: string, leaf: string): TypeRegistry => {
    const three = object('L3', [field('leaf', leaf)]);
    const registry: TypeRegistry = { [`type:${repo}#L3`]: three };
    registry[`type:${repo}#L2`] = object('L2', [field('next', `type:${repo}#L3`)], registry);
    registry[`type:${repo}#L1`] = object('L1', [field('next', `type:${repo}#L2`)], registry);
    return registry;
  };
  const registry = { ...chain('a', 'string'), ...chain('b', 'number') };

  it('stops at the cut and says the shapes differ below it', () => {
    const sender = object('A', [field('next', 'type:a#L1')], registry);
    const receiver = object('B', [field('next', 'type:b#L1')], registry);
    const { diffs, rulesApplied } = diffTypes(sender, receiver, (id) => registry[id], { depth: 2 });
    expect(rulesApplied).toContain('depth-cap:next.next');
    expect(diffs[0]?.message).toContain('below the depth this run compared');
  });

  it('names the field when asked to look deeper', () => {
    const sender = object('A', [field('next', 'type:a#L1')], registry);
    const receiver = object('B', [field('next', 'type:b#L1')], registry);
    expect(kinds(compareTypes(sender, receiver, registry, { depth: 6 }))).toEqual([
      'type_mismatch next.next.next.leaf',
    ]);
  });

  it('terminates on a shape that contains itself', () => {
    const cyclic: TypeRegistry = {
      'type:a#Category': object('Category', [
        field('id', 'string'),
        field('children', 'type:a#Category[]'),
      ]),
      'type:b#Category': object('Category', [
        field('code', 'string'),
        field('children', 'type:b#Category[]'),
      ]),
    };
    const { diffs, rulesApplied } = diffTypes(
      cyclic['type:a#Category'] as TypeEntry,
      cyclic['type:b#Category'] as TypeEntry,
      (id) => cyclic[id],
      { depth: 20 },
    );
    expect(kinds(diffs)).toEqual(['missing_required code', 'extra_field id']);
    expect(rulesApplied.some((rule) => rule.startsWith('cycle:'))).toBe(true);
  });
});

describe('what the comparator refuses to guess', () => {
  it('says nothing about a type nothing was read from', () => {
    const registry = {
      'type:lib#Decimal': {
        name: 'Decimal',
        kind: 'external',
        declaredIn: 'lib',
        structuralHash: 'x',
      },
    } as TypeRegistry;
    const sender = object('A', [field('id', 'type:lib#Decimal')], registry);
    const receiver = object('B', [field('id', 'number')], registry);
    const { diffs, rulesApplied } = diffTypes(sender, receiver, (id) => registry[id]);
    expect(diffs).toEqual([]);
    expect(rulesApplied).toContain('unreadable-type:id');
  });

  it('says nothing about a reference the registry does not hold', () => {
    const sender = object('A', [field('at', 'type:a#Gone')]);
    const receiver = object('B', [field('at', 'number')]);
    const { diffs, rulesApplied } = diffTypes(sender, receiver, () => undefined);
    expect(diffs).toEqual([]);
    expect(rulesApplied).toContain('type-missing:at');
  });
});

describe('the hash short-circuit', () => {
  it('skips the walk when two shapes hash alike', () => {
    const sender = object('A', [field('id', 'string')]);
    const receiver = object('B', [field('id', 'string')]);
    expect(sender.structuralHash).toBe(receiver.structuralHash);
    expect(compareTypes(sender, receiver, {})).toEqual([]);
  });

  it('walks anyway when an annotation changes what goes on the wire', () => {
    // The hash ignores annotations by design (P02), so two shapes can hash alike
    // and still not agree: one of them drops a field on the way out.
    const sender = object('A', [field('id', 'string', false, { exclude: true })]);
    const receiver = object('B', [field('id', 'string')]);
    expect(sender.structuralHash).toBe(receiver.structuralHash);
    expect(kinds(compareTypes(sender, receiver, {}))).toEqual(['missing_required id']);
  });
});

describe('a choice on either side of the wire', () => {
  const registry: TypeRegistry = {};
  const page = object('Page', [field('items', 'type:web#Entry[]'), field('total', 'number')], registry);
  const entry = object('Entry', [field('id', 'string')], registry);
  const doc = object('Doc', [field('id', 'string'), field('extra', 'string')], registry);
  registry['type:web#Page'] = page;
  registry['type:web#Entry'] = entry;
  registry['type:api#Doc'] = doc;

  it('passes when any shape the receiver declares reads what arrives', () => {
    const sender = object('Out', [field('data', 'type:api#Doc[]')], registry);
    const receiver = object('In', [field('data', 'type:web#Entry[]|type:web#Page')], registry);
    expect(
      kinds(compareTypes(sender, receiver, registry)).filter(
        (kind) => kind.startsWith('missing_required') || kind.startsWith('type_mismatch'),
      ),
    ).toEqual([]);
  });

  it('reads every shape the sender may send, and names only the one nothing reads', () => {
    const sender = object('Out', [field('body', '{refreshToken:string}|{other:number}')], registry);
    const receiver = object('In', [field('body', '{refreshToken?:string}')], registry);
    const breaking = (diffs: readonly FieldDiff[]) =>
      kinds(diffs.filter((diff) => diff.kind === 'missing_required' || diff.kind === 'type_mismatch'));
    expect(breaking(compareTypes(sender, receiver, registry))).toEqual([]);
    const strict = object('Strict', [field('body', '{refreshToken:string}')], registry);
    expect(kinds(compareTypes(sender, strict, registry))).toContain('missing_required body.refreshToken');
  });

  it('reads a named union of shapes as shapes, not as a list of values', () => {
    registry['type:api#Result'] = values('Result', 'union', ['type:api#Doc', '{pending:boolean}'], registry);
    const sender = object('Out', [field('result', 'type:api#Result')], registry);
    const receiver = object('In', [field('result', '{id?:string;pending?:boolean}')], registry);
    const found = compareTypes(sender, receiver, registry).filter(
      (diff) => diff.kind === 'missing_required' || diff.kind === 'type_mismatch',
    );
    expect(found).toEqual([]);
  });

  it('compares what is left once a tolerant receiver has taken its null', () => {
    const sender = object('Out', [field('sizes', 'type:web#Entry[]')], registry);
    const receiver = object('In', [field('sizes', 'null|type:api#Doc[]')], registry);
    expect(kinds(compareTypes(sender, receiver, registry))).toEqual(['missing_required sizes[].extra']);
  });

  it('names the shape a required field is missing from, and counts the ones it is on', () => {
    // The whole of R32: the verdict was right and the sentence was not. "does
    // not send it" read as "never sends it", and which of the two shapes it
    // was had been sitting in the type all along.
    const sender = object('Out', [field('body', 'type:api#Doc|{pending:boolean}')], registry);
    const receiver = object('In', [field('body', '{extra:string}')], registry);
    const [found] = compareTypes(sender, receiver, registry).filter(
      (diff) => diff.kind === 'missing_required' && diff.path === 'body.extra',
    );
    expect(found?.note).toContain('1 of the 2 shapes');
    expect(found?.note).toContain('{pending}');
  });

  it('says only which shape it is when the field is on none of them', () => {
    const sender = object('Out', [field('body', '{a:string}|{pending:boolean}')], registry);
    const receiver = object('In', [field('body', '{extra:string}')], registry);
    const notes = compareTypes(sender, receiver, registry)
      .filter((diff) => diff.kind === 'missing_required' && diff.path === 'body.extra')
      .map((diff) => diff.note ?? '');
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note).not.toContain('of the 2 shapes this may answer with, and not on');
      expect(note).toContain('one of the 2 shapes');
    }
  });

  it('accepts a bare null sent to a receiver that declares null', () => {
    const sender = object('Out', [field('stoppedAt', 'null')], registry);
    const receiver = object('In', [field('stoppedAt', 'null|string')], registry);
    expect(kinds(compareTypes(sender, receiver, registry))).toEqual([]);
  });
});
