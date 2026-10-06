import { nameInForms } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { DEPLOYED_FORMS, deployedArn, deployedNameIn, eventChannel, queueChannel, topicChannel } from './index.js';

describe('the channel grammar', () => {
  it('names each service and the default bus explicitly', () => {
    expect(queueChannel('returns')).toBe('sqs/returns');
    expect(topicChannel('borrower-notifications')).toBe('sns/borrower-notifications');
    expect(eventChannel(undefined, 'library.loans', 'LoanCreated')).toBe('eventbridge/default/library.loans/LoanCreated');
  });
});

describe('the forms a deployed name is written inside', () => {
  it('reads every kind out of its ARN, and a queue out of its URL', () => {
    expect(deployedNameIn('arn:aws:lambda:eu-west-1:111122223333:function:notify-borrower')).toEqual({ kind: 'function', name: 'notify-borrower' });
    expect(deployedNameIn('arn:aws:states:eu-west-1:111122223333:stateMachine:loan-approval')).toEqual({ kind: 'workflow', name: 'loan-approval' });
    expect(deployedNameIn('https://sqs.eu-west-1.amazonaws.com/111122223333/returns')).toEqual({ kind: 'queue', name: 'returns' });
    expect(deployedNameIn('arn:aws:sqs:eu-west-1:111122223333:returns.fifo')).toEqual({ kind: 'queue', name: 'returns.fifo' });
    expect(deployedNameIn('arn:aws:sns:eu-west-1:111122223333:withdrawals')).toEqual({ kind: 'topic', name: 'withdrawals' });
    expect(deployedNameIn('arn:aws:events:eu-west-1:111122223333:event-bus/library')).toEqual({ kind: 'bus', name: 'library' });
    expect(deployedNameIn('arn:aws:dynamodb:eu-west-1:111122223333:table/loans')).toEqual({ kind: 'table', name: 'loans' });
    expect(deployedNameIn('arn:aws:kinesis:eu-west-1:111122223333:stream/returns')).toEqual({ kind: 'stream', name: 'returns' });
  });

  it('drops a version or an alias, and keeps a region or an account left open', () => {
    expect(nameInForms('arn:aws:lambda:::function:notify-borrower:live', DEPLOYED_FORMS.function)).toBe('notify-borrower');
    expect(nameInForms('arn:aws:states:::stateMachine:loan-approval:2', DEPLOYED_FORMS.workflow)).toBe('loan-approval');
  });

  it('reads a table out of the ARN of its stream of changes, and says so', () => {
    expect(deployedNameIn('arn:aws:dynamodb:eu-west-1:111122223333:table/loans/stream/2026-01-01T00:00:00.000')).toEqual({
      kind: 'table',
      name: 'loans',
      changes: true,
    });
  });

  it('names a partner bus by everything after event-bus/', () => {
    expect(nameInForms('arn:aws:events:eu-west-1:111122223333:event-bus/partner/example.org/library', DEPLOYED_FORMS.bus)).toBe(
      'partner/example.org/library',
    );
  });

  it('reads back every ARN it spells', () => {
    for (const kind of Object.keys(DEPLOYED_FORMS) as (keyof typeof DEPLOYED_FORMS)[]) {
      expect(deployedNameIn(deployedArn(kind, 'returns'))).toEqual({ kind, name: 'returns' });
    }
  });

  it('answers nothing for text that is not one of them', () => {
    expect(deployedNameIn('returns')).toBeUndefined();
    expect(deployedNameIn('arn:aws:iam::111122223333:role/library')).toBeUndefined();
  });
});
