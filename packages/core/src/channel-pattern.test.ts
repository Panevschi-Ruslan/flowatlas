import { describe, expect, it } from 'vitest';
import { matchChannelPattern, nameWithin, type ChannelPattern } from './channel-pattern.js';

const events = (source: ChannelPattern['parts'][number]['filters'], detailType: ChannelPattern['parts'][number]['filters']): ChannelPattern => ({
  parts: [
    { name: 'service', filters: [{ equals: 'eventbridge' }] },
    { name: 'bus', filters: [{ equals: 'library' }] },
    { name: 'source', filters: source },
    { name: 'detail-type', filters: detailType },
  ],
});

describe('matchChannelPattern', () => {
  it('is exact where every part is matched by an exact value', () => {
    expect(matchChannelPattern('eventbridge/library/library.loans/LoanCreated', events([{ equals: 'library.loans' }], [{ equals: 'LoanCreated' }]))).toEqual({
      exact: true,
      because: [],
    });
  });

  it('says which part matched by a filter, and that a part not filtered matches anything', () => {
    expect(matchChannelPattern('eventbridge/library/library.loans/LoanCreated', events([{ prefix: 'library.' }], []))).toEqual({
      exact: false,
      because: ['source "library.loans" matches prefix "library."', 'detail-type is not filtered'],
    });
  });

  it('reads every content filter as written', () => {
    const name = 'eventbridge/library/library.loans/LoanReturned';
    const match = (filter: ChannelPattern['parts'][number]['filters'][number]): boolean =>
      matchChannelPattern(name, events([{ equals: 'library.loans' }], [filter])) !== undefined;
    expect(match({ suffix: 'Returned' })).toBe(true);
    expect(match({ equalsIgnoreCase: 'loanreturned' })).toBe(true);
    expect(match({ wildcard: 'Loan*ed' })).toBe(true);
    expect(match({ wildcard: 'Hold*' })).toBe(false);
    expect(match({ anythingBut: [{ equals: 'LoanCreated' }] })).toBe(true);
    expect(match({ anythingBut: [{ prefix: 'Loan' }] })).toBe(false);
    expect(match({ exists: true })).toBe(true);
    expect(match({ exists: false })).toBe(false);
    expect(match({ unread: '{"numeric":[">",1]}' })).toBe(false);
  });

  it('matches nothing on another bus, or a name of another shape', () => {
    expect(matchChannelPattern('eventbridge/default/library.loans/LoanCreated', events([], []))).toBeUndefined();
    expect(matchChannelPattern('sqs/library-returns', events([], []))).toBeUndefined();
  });

  it('lets a part the publisher did not read match only where the pattern does not filter it', () => {
    expect(matchChannelPattern('eventbridge/library/library.loans/*', events([{ equals: 'library.loans' }], []))).toEqual({
      exact: false,
      because: ['detail-type is not filtered'],
    });
    expect(matchChannelPattern('eventbridge/library/library.loans/*', events([{ equals: 'library.loans' }], [{ prefix: 'Loan' }]))).toBeUndefined();
  });
});

describe('nameWithin', () => {
  it('reads the name out of the first form that matches, and leaves a plain name alone', () => {
    const forms = ['^https?://[^/]+/[^/]+/([^/?#]+)/?$', '^id:[^:]+:queue:[^:]*:([^:]+)$'];
    expect(nameWithin('https://queues.example.org/111122223333/library-returns', forms)).toBe('library-returns');
    expect(nameWithin('id:cloud:queue:region-1:library-returns', forms)).toBe('library-returns');
    expect(nameWithin('library-returns', forms)).toBe('library-returns');
  });
});
