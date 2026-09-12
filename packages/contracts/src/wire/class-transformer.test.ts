import { describe, expect, it } from 'vitest';
import { field } from '../test-graph.js';
import { compareField, rulesFor } from './wire-case.js';

describe('the serialisation annotations', () => {
  it('matches a renamed field under the name it arrives with', () => {
    const pair = {
      sent: field('customerId', 'string', false, { expose: true, exposeAs: 'customer_id' }),
      expected: field('customer_id', 'string'),
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('class-transformer:customerId');
  });

  it('matches when it is the receiver that renames it', () => {
    expect(
      compareField({
        sent: field('customer_id', 'string'),
        expected: field('customerId', 'string', false, { exposeAs: 'customer_id' }),
      }),
    ).toEqual([]);
  });

  it('reports a required field the sender excludes as missing, and says which rule took it', () => {
    const [diff] = compareField({
      sent: field('secret', 'string', false, { exclude: true }),
      expected: field('secret', 'string'),
    });
    expect(diff?.kind).toBe('missing_required');
    expect(diff?.rule).toBe('class-transformer');
    expect(diff?.message).toContain('excludes it from serialisation');
  });

  it('says nothing when the sender excludes a field the receiver does not require', () => {
    expect(
      compareField({
        sent: field('secret', 'string', false, { exclude: true }),
        expected: field('secret', 'string', true),
      }),
    ).toEqual([]);
  });

  it('reports what the receiver excludes as sent and unread, not as a mismatch', () => {
    const [diff] = compareField({
      sent: field('internalNote', 'string'),
      expected: field('internalNote', 'number', true, { exclude: true }),
    });
    expect(diff?.kind).toBe('extra_field');
    expect(diff?.message).toContain('thrown away');
  });

  it('leaves a transformed field alone, since no declaration says what it becomes', () => {
    const pair = {
      sent: field('coupon', 'string', false, { transform: true }),
      expected: field('coupon', 'number'),
    };
    expect(compareField(pair)).toEqual([]);
    expect(rulesFor(pair)).toContain('class-transformer:transform:coupon');
  });

  it('reports the pair it excuses once the rule is switched off', () => {
    expect(
      compareField({
        sent: field('customerId', 'string', false, { exposeAs: 'customer_id' }),
        expected: field('customer_id', 'string'),
        disableRules: ['class-transformer'],
      }).map((diff) => `${diff.kind} ${diff.path}`),
    ).toEqual(['extra_field customerId', 'missing_required customer_id']);
  });
});
