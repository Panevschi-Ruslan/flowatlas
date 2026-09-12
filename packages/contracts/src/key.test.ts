import { describe, expect, it } from 'vitest';
import { edgeKeyOf, findingKey } from './key.js';
import type { ContractFinding } from './types.js';

/**
 * The identity of a finding, which is what makes two reports comparable.
 *
 * `diff` (P12) decides new from fixed from pre-existing by this string alone,
 * so anything that moves when the code is merely edited must not be in it.
 */

const finding = (over: Partial<ContractFinding> = {}): ContractFinding => ({
  severity: 'error',
  kind: 'missing_required',
  edge: { from: 'a', to: 'b', type: 'http_calls' },
  edgeKey: 'a|http_calls|b',
  direction: 'request',
  sender: { service: 'one', typeId: 'type:one#A', symbol: 'one#A.m' },
  receiver: { service: 'two', typeId: 'type:two#A', symbol: 'two#B.n' },
  typeId: 'type:two#A',
  field: 'channel',
  expected: 'string',
  actual: null,
  rule: null,
  message: 'receiver two requires `channel: string`; sender one does not send it',
  ignored: false,
  ignoredBy: null,
  ...over,
});

describe('the key of a finding', () => {
  it('is made of where, which half, what kind, whose type and which field', () => {
    expect(findingKey(finding())).toBe(
      'a|http_calls|b|request|missing_required|type:two#A|channel',
    );
  });

  it('survives a reworded message', () => {
    expect(findingKey(finding({ message: 'something else entirely' }))).toBe(
      findingKey(finding()),
    );
  });

  it('survives the code moving down the file', () => {
    // Nothing in the key is a line, and nothing in it is a symbol either: a
    // method renamed is a different finding, a method moved is the same one.
    expect(
      findingKey(
        finding({ sender: { service: 'one', typeId: 'type:one#A', symbol: 'one#A.m2' } }),
      ),
    ).toBe(findingKey(finding()));
  });

  it('changes when the field does', () => {
    expect(findingKey(finding({ field: 'other' }))).not.toBe(findingKey(finding()));
  });

  it('changes when the half of the exchange does', () => {
    expect(findingKey(finding({ direction: 'response' }))).not.toBe(findingKey(finding()));
  });
});

describe('the key of an edge', () => {
  it('is `from|type|to`, which is what diff keys on as well', () => {
    expect(edgeKeyOf({ from: 'a', type: 'hits', to: 'b' })).toBe('a|hits|b');
  });
});
