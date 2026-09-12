import { describe, expect, it } from 'vitest';
import { severityOf } from '../severity.js';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('a set and a map do not survive JSON', () => {
  it('warns once about a set even when the two sides agree about the element', () => {
    const pair = { sent: field('tags', 'Set<string>'), expected: field('tags', 'string[]') };
    const diffs = compareField(pair);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.kind).toBe('type_mismatch');
    expect(diffs[0]?.rule).toBe('set-map-json');
    expect(rulesFor(pair)).toContain('set-map-json:tags');
  });

  it('warns once about a map as well', () => {
    const diffs = compareField({
      sent: field('counts', 'Map<string,number>'),
      expected: field('counts', 'Record<string,number>'),
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.rule).toBe('set-map-json');
  });

  it('warns rather than fails, because nothing here says what actually arrives', () => {
    expect(severityOf('type_mismatch', 'set-map-json')).toBe('warning');
    expect(severityOf('type_mismatch', null)).toBe('error');
  });

  it('warns once and not twice when both sides declare a set', () => {
    expect(
      compareField({ sent: field('tags', 'Set<string>'), expected: field('tags', 'Set<string>') }),
    ).toHaveLength(1);
  });

  it('says nothing at all once the rule is switched off and the two agree', () => {
    expect(
      compareField({
        sent: field('tags', 'Set<string>'),
        expected: field('tags', 'Set<string>'),
        disableRules: ['set-map-json'],
      }),
    ).toEqual([]);
  });
});
