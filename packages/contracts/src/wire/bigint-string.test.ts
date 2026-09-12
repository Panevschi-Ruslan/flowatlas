import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('a big integer crosses as text', () => {
  it('says nothing when one side has the integer and the other the string', () => {
    const pair = { sent: field('reference', 'bigint'), expected: field('reference', 'string') };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('bigint-string:reference');
  });

  it('does not hide one declared as an ordinary number', () => {
    expect(
      compareField({ sent: field('reference', 'bigint'), expected: field('reference', 'number') }),
    ).toHaveLength(1);
  });

  it('reports the pair it excuses once the rule is switched off', () => {
    expect(
      compareField({
        sent: field('reference', 'bigint'),
        expected: field('reference', 'string'),
        disableRules: ['bigint-string'],
      }),
    ).toHaveLength(1);
  });
});
