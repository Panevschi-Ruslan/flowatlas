import { describe, expect, it } from 'vitest';
import { eventPatternOf } from './event-pattern.js';
import { cognitoTriggerKey, destinationOf } from './triggers.js';

describe('an event pattern, as JSON every reader hands over (P57)', () => {
  it('reads each field of alternatives, content filters included, and keeps the rest unmatched', () => {
    expect(
      eventPatternOf({
        source: ['orders.service'],
        'detail-type': [{ prefix: 'Order' }, { 'anything-but': ['OrderTest'] }],
        detail: { status: ['placed'] },
        $or: [{ source: ['a'] }],
      }),
    ).toEqual({
      fields: { source: [{ equals: 'orders.service' }], 'detail-type': [{ prefix: 'Order' }, { anythingBut: [{ equals: 'OrderTest' }] }] },
      unmatched: { detail: { status: ['placed'] }, $or: [{ source: ['a'] }] },
    });
  });

  it('says so when the pattern is not an object', () => {
    expect(eventPatternOf(['orders'])).toEqual({ reason: 'not-an-object', text: 'the event pattern is not a JSON object' });
  });
});

describe('the spellings every reader of a deployment shares (P57)', () => {
  it('spells a user pool trigger as Terraform does, whichever way it is written', () => {
    for (const written of ['PreSignUp', 'preSignUp', 'PRE_SIGN_UP', 'pre_sign_up']) expect(cognitoTriggerKey('members', written)).toBe('cognito/members/pre_sign_up');
    expect(cognitoTriggerKey('members', 'CustomSMSSender')).toBe('cognito/members/custom_sms_sender');
  });

  it('names a result put on a bus by the platform own source and detail type', () => {
    expect(destinationOf({ kind: 'bus', name: 'default' }, 'failure')).toEqual({
      kind: 'bus',
      name: 'default',
      fields: { source: 'lambda', 'detail-type': 'Lambda Function Invocation Result - Failure' },
    });
    expect(destinationOf({ kind: 'queue', name: 'failed' }, 'failure')).toEqual({ kind: 'queue', name: 'failed' });
  });
});
