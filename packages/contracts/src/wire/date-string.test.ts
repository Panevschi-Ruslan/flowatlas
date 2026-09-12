import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('a date is a string once it is JSON', () => {
  it('says nothing when one side has the date and the other the string', () => {
    const pair = { sent: field('placedAt', 'Date'), expected: field('placedAt', 'string') };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('date-string:placedAt');
  });

  it('works the other way round as well', () => {
    expect(
      compareField({ sent: field('placedAt', 'string'), expected: field('placedAt', 'Date') }),
    ).toEqual([]);
  });

  it('reaches inside an array', () => {
    expect(
      compareField({ sent: field('days', 'Date[]'), expected: field('days', 'string[]') }),
    ).toEqual([]);
  });

  it('does not hide a date declared as a number', () => {
    const [diff] = compareField({
      sent: field('placedAt', 'Date'),
      expected: field('placedAt', 'number'),
    });
    expect(diff?.kind).toBe('type_mismatch');
    expect(diff?.actual).toBe('string');
  });

  it('reports the pair it excuses once the rule is switched off', () => {
    const diffs = compareField({
      sent: field('placedAt', 'Date'),
      expected: field('placedAt', 'string'),
      disableRules: ['date-string'],
    });
    expect(diffs.map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });
});
