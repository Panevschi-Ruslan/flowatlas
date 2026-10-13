import { describe, expect, it } from 'vitest';
import { forwardedName } from './channel-pattern.js';
import { operationsOf } from './declared-operations.js';

describe('operationsOf', () => {
  const paths = {
    '/loans/{loanId}': { parameters: [], get: { operationId: 'getLoan' }, summary: 'a loan' },
    '/loans': { post: { operationId: 'createLoan' }, 'x-any': { operationId: 'any' } },
  };

  it('walks the paths in order and only the keys that are verbs', () => {
    expect(operationsOf(paths).map(({ rawPath, verb }) => `${verb} ${rawPath}`)).toEqual(['POST /loans', 'GET /loans/{loanId}']);
  });

  it('takes a verb of the reader\'s own', () => {
    expect(operationsOf(paths, { 'x-any': 'ALL' }).map(({ rawPath, verb, operation }) => [verb, rawPath, operation['operationId']])).toEqual([
      ['ALL', '/loans', 'any'],
    ]);
  });
});

describe('forwardedName', () => {
  it('replaces the parts a forward names and keeps the rest', () => {
    expect(forwardedName('eventbridge/library/library.loans/LoanCreated', { producer: 'p', parts: [null, 'audit', null, null] })).toBe(
      'eventbridge/audit/library.loans/LoanCreated',
    );
  });

  it('carries on nothing whose name has other parts', () => {
    expect(forwardedName('sqs/returns', { producer: 'p', parts: [null, 'audit', null, null] })).toBeUndefined();
  });
});
