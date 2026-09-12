import { describe, expect, it } from 'vitest';
import { field, object } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe("a document store's identifier is a string once it is JSON", () => {
  const registry = {
    'type:bson#ObjectId': {
      name: 'ObjectId',
      kind: 'external' as const,
      declaredIn: 'bson',
      structuralHash: 'objectid',
    },
  };

  it('says nothing when one side has the identifier and the other the string', () => {
    const pair = {
      sent: field('userId', 'type:bson#ObjectId'),
      expected: field('userId', 'string'),
      registry,
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('objectid-string:userId');
  });

  it('says nothing about the union a schema usually writes', () => {
    expect(
      compareField({
        sent: field('userId', 'string|type:bson#ObjectId'),
        expected: field('userId', 'null|string'),
        registry,
      }),
    ).toEqual([]);
  });

  it('leaves the reference alone when the far side declares what it points at', () => {
    // A store that can put either the identifier or the document it names into
    // the same field decides which per query, and neither declaration says
    // which query this is.
    const withDoc = { ...registry, 'type:web#User': object('User', [field('name', 'string')]) };
    const pair = {
      sent: field('user', 'type:bson#ObjectId'),
      expected: field('user', 'type:web#User'),
      registry: withDoc,
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('objectid-string:referenced:user');
  });

  it('goes back to saying nothing at all once the rule is switched off', () => {
    // Without the rule the identifier is a package's type nothing was read
    // from, which is a different kind of silence and a less useful one.
    const pair = {
      sent: field('userId', 'type:bson#ObjectId'),
      expected: field('userId', 'string'),
      registry,
      disableRules: ['objectid-string'],
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('unreadable-type:userId');
  });
});
