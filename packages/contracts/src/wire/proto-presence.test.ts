import { parseProto, parseTypeRef, protoTypes, type TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { compareTypes, diffRefs } from '../compare.js';
import { field, object } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

const implicit = (name: string, type: string) => field(name, type, false, { protoPresence: 'implicit' });

describe('a field of a gRPC message (P287)', () => {
  it('may be left out by the sender, and is no question of optionality when the sender always writes it', () => {
    expect(compareField({ sent: field('userId', 'string', true), expected: implicit('userId', 'string') })).toEqual([]);
    expect(compareField({ sent: field('userId', 'string'), expected: field('userId', 'string', true, { protoPresence: 'explicit' }) })).toEqual([]);
    expect(rulesFor({ sent: field('userId', 'string', true), expected: implicit('userId', 'string') })).toContain('proto-presence:userId');
  });

  it('sends a 64-bit integer in the form the reader\'s library chooses, and still holds a writer of one to the forms a library accepts', () => {
    const long = (optional: boolean) => field('units', 'number | string', optional, { protoPresence: 'implicit', protoForm: 'library' });
    expect(compareField({ sent: long(false), expected: field('units', 'number') })).toEqual([]);
    expect(rulesFor({ sent: long(false), expected: field('units', 'number') })).toContain('proto-presence:units');
    expect(compareField({ sent: field('units', 'boolean'), expected: long(false) }).map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });

  it('still refuses a value of the wrong kind', () => {
    const diffs = compareField({ sent: field('quantity', 'string'), expected: implicit('quantity', 'number') });
    expect(diffs.map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });

  it('is required where nothing marks it a gRPC field, so switching the rule off brings the question back', () => {
    const diffs = compareField({ sent: field('userId', 'string', true), expected: implicit('userId', 'string'), disableRules: ['proto-presence'] });
    expect(diffs.map((diff) => diff.kind)).toEqual(['optionality_mismatch']);
  });
});

describe('a request compared with the message a contract declares (P287)', () => {
  const contract = parseProto(`
    syntax = "proto3";
    package shop;
    message AddItemRequest { string user_id = 1; Item item = 2; }
    message Item { string product_id = 1; int32 quantity = 2; }
    message Pay { string order_id = 1; oneof method { string card = 2; string voucher = 3; } }
  `);
  const types = protoTypes([{ path: 'shop.proto', file: contract }], 'cart');
  const request = types.refOf('AddItemRequest', 'shop');
  const pay = types.refOf('Pay', 'shop');
  const registry = { ...types.registry() };

  it('agrees with a request that writes the fields as JavaScript names them', () => {
    const sent = object('Sent', [field('userId', 'string'), field('item', '{ productId: string; quantity: number }')], registry);
    expect(compareTypes(sent, registry[request]!, registry)).toEqual([]);
  });

  it('says a field the message does not declare, and a value of the wrong kind', () => {
    const sent = object('Sent', [field('user_id', 'string'), field('item', '{ productId: string; quantity: string }')], registry);
    expect(compareTypes(sent, registry[request]!, registry).map((diff) => [diff.kind, diff.path])).toEqual([
      ['type_mismatch', 'item.quantity'],
      ['extra_field', 'user_id'],
    ]);
  });

  it('claims nothing about a message below the depth compared, whose hash no language type can share', () => {
    const local: TypeRegistry = {
      ...registry,
      'type:web#Item': { name: 'Item', kind: 'object' as const, declaredIn: 'web#item.ts', structuralHash: 'ffffffffffffffff', fields: [field('productId', 'string'), field('quantity', 'number')] },
      'type:web#Req': { name: 'Req', kind: 'object' as const, declaredIn: 'web#item.ts', structuralHash: 'eeeeeeeeeeeeeeee', fields: [field('userId', 'string'), field('item', 'type:web#Item')] },
    };
    const compared = diffRefs(parseTypeRef('type:web#Req'), parseTypeRef(request), (id) => local[id], { depth: 1 });
    expect(compared.diffs).toEqual([]);
    expect(compared.rulesApplied.filter((rule) => rule.startsWith('depth-cap'))).toEqual(['depth-cap:item']);
  });

  it('reads a oneof as a choice: one member agrees, and a second member beside it is not declared there', () => {
    // As the check compares a request: by reference, so the choice is opened arm by arm.
    const against = (sent: string) => diffRefs(parseTypeRef(sent), parseTypeRef(pay), (id) => registry[id]).diffs.map((diff) => [diff.kind, diff.path]);
    expect(against('{ orderId: string; card: string }')).toEqual([]);
    expect(against('{ orderId: string; card: string; voucher: string }')).toEqual([['extra_field', 'voucher']]);
    expect(against('{ orderId: number; card: string }')).toEqual([['type_mismatch', 'orderId']]);
  });
});
