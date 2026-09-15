import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

const validated = (name: string, type: string) =>
  ({ ...field(name, type, true), meta: { validators: ['IsOptional', 'IsString'], optionalBy: 'question' } });

describe('a field the receiving validator marks optional', () => {
  it('accepts the null a sender writes there', () => {
    const pair = { sent: field('notes', 'null|string', true), expected: validated('notes', 'string') };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('optional-accepts-null:notes');
  });

  it('still refuses a value of the wrong kind', () => {
    const diffs = compareField({ sent: field('notes', 'null|number', true), expected: validated('notes', 'string') });
    expect(diffs.map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });

  it('says so when nothing but the question mark makes it optional', () => {
    const diffs = compareField({
      sent: field('notes', 'null|string', true),
      expected: field('notes', 'string', true),
    });
    expect(diffs.map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });

  it('can be switched off', () => {
    const diffs = compareField({
      sent: field('notes', 'null|string', true),
      expected: validated('notes', 'string'),
      disableRules: ['optional-accepts-null'],
    });
    expect(diffs.map((diff) => diff.kind)).toEqual(['type_mismatch']);
  });
});

describe('a null sent where an unvalidated receiver declares the field optional', () => {
  it('is a softened finding, not an error', () => {
    const diffs = compareField({
      sent: field('stoppedAt', 'null|string', true),
      expected: field('stoppedAt', 'string', true),
    });
    expect(diffs.map((diff) => [diff.kind, diff.rule])).toEqual([['type_mismatch', 'null-for-optional']]);
  });

  it('stays an error when the receiver validates the field and does not skip empty values', () => {
    const diffs = compareField({
      sent: field('code', 'null|string', true),
      expected: field('code', 'string', true, { validators: ['IsString'] }),
    });
    expect(diffs.map((diff) => [diff.kind, diff.rule])).toEqual([['type_mismatch', null]]);
  });

  it('stays an error when something besides the null disagrees', () => {
    const diffs = compareField({
      sent: field('count', 'null|string', true),
      expected: field('count', 'number', true),
    });
    expect(diffs.map((diff) => [diff.kind, diff.rule])).toEqual([['type_mismatch', null]]);
  });
});
