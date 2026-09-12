import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('a field holding nothing is never written', () => {
  it('reads `T | undefined` as optionality rather than as a different type', () => {
    const pair = {
      sent: field('note', 'string|undefined'),
      expected: field('note', 'string', true),
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('undefined-vanishes:note');
  });

  it('calls it optionality when the receiver requires it, not absence', () => {
    const [diff] = compareField({
      sent: field('note', 'string|undefined'),
      expected: field('note', 'string'),
    });
    expect(diff?.kind).toBe('optionality_mismatch');
    expect(diff?.optionalOn).toBe('sender');
  });

  it('calls a field that can only hold nothing absent', () => {
    const [diff] = compareField({
      sent: field('reference', 'undefined'),
      expected: field('reference', 'string'),
    });
    expect(diff?.kind).toBe('missing_required');
    expect(diff?.rule).toBe('undefined-vanishes');
    expect(diff?.message).toContain('nothing is ever written');
  });

  it('leaves `null` alone, because JSON carries it', () => {
    const [diff] = compareField({
      sent: field('note', 'string|null'),
      expected: field('note', 'string'),
    });
    expect(diff?.kind).toBe('type_mismatch');
  });
});
