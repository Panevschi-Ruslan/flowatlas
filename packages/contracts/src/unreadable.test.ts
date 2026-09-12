import type { TypeRegistry } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { diffTypes } from './compare.js';
import { field, object, values } from './test-graph.js';

/**
 * What the comparator does when the graph does not say enough.
 *
 * Every one of these could be answered by agreeing with whatever the other side
 * declares, and every one of those answers would be a claim nobody made. The
 * rule is the same each time: say that it could not be read, and say where.
 */

describe('a set of values with no values recorded', () => {
  const registry: TypeRegistry = {
    'type:a#Status': { ...values('Status', 'enum', ['new', 'paid']), members: [] },
    'type:b#Status': values('Status', 'union', ["'new'"]),
  };

  it('is read as unreadable rather than as agreeing with everything', () => {
    // A graph written before the store kept a type's members looks exactly like
    // this, and agreeing was what it used to do — silently, and only through
    // the database, which is the path the command itself takes.
    const sender = object('A', [field('status', 'type:a#Status')], registry);
    const receiver = object('B', [field('status', 'type:b#Status')], registry);
    const { diffs, rulesApplied } = diffTypes(sender, receiver, (id) => registry[id]);
    expect(diffs).toEqual([]);
    expect(rulesApplied).toContain('unreadable-type:status');
  });
});

describe('an alias that resolves to nothing but itself', () => {
  it('is read as unreadable, not as a union that cannot stand in for a shape', () => {
    const registry: TypeRegistry = {
      'type:a#Thing': values('Thing', 'union', ['type:a#Thing']),
      'type:b#Thing': object('Thing', [field('id', 'string')]),
    };
    const sender = object('A', [field('thing', 'type:a#Thing')], registry);
    const receiver = object('B', [field('thing', 'type:b#Thing')], registry);
    const { diffs, rulesApplied } = diffTypes(sender, receiver, (id) => registry[id]);
    expect(diffs).toEqual([]);
    expect(rulesApplied).toContain('unreadable-type:thing');
  });
});
