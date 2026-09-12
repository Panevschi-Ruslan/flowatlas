import { describe, expect, it } from 'vitest';
import { field, object } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('a field that claims nothing', () => {
  it('is skipped whichever side claims nothing', () => {
    expect(compareField({ sent: field('x', 'any'), expected: field('x', 'string') })).toEqual([]);
    expect(compareField({ sent: field('x', 'string'), expected: field('x', 'unknown') })).toEqual([]);
  });

  it('is recorded as skipped rather than passed over in silence', () => {
    expect(rulesFor({ sent: field('x', 'any'), expected: field('x', 'string') })).toContain(
      'any-unknown-skip:x',
    );
  });

  it('is still required to be there when the receiver requires it', () => {
    const diffs = compareField({ sent: field('other', 'string'), expected: field('x', 'any') });
    expect(diffs.map((diff) => `${diff.kind} ${diff.path}`)).toEqual([
      'extra_field other',
      'missing_required x',
    ]);
  });
});
