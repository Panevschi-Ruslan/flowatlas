import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('binary arrives as text', () => {
  it('says nothing when one side has the buffer and the other the string', () => {
    const pair = { sent: field('signature', 'Buffer'), expected: field('signature', 'string') };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('buffer-string:signature');
  });

  it('does not hide one declared as an array of numbers', () => {
    expect(
      compareField({ sent: field('signature', 'Buffer'), expected: field('signature', 'number[]') }),
    ).toHaveLength(1);
  });

  it('reports the pair it excuses once the rule is switched off', () => {
    expect(
      compareField({
        sent: field('signature', 'Buffer'),
        expected: field('signature', 'string'),
        disableRules: ['buffer-string'],
      }),
    ).toHaveLength(1);
  });
});
