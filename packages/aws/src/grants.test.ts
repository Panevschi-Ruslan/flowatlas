import { describe, expect, it } from 'vitest';
import { grantedIn, kindsGranted } from './grants.js';

/** What a permission lets a function write to (P272). */
describe('kindsGranted', () => {
  it('reads the kinds a list of actions writes to, wildcards and case aside', () => {
    expect(kindsGranted(['sqs:SendMessage'])).toEqual(['queue']);
    expect(kindsGranted(['SNS:publish', 'kinesis:Put*'])).toEqual(['topic', 'stream']);
    expect(kindsGranted(['dynamodb:*'])).toEqual(['table']);
    expect(kindsGranted(['*'])).toEqual(['queue', 'topic', 'bus', 'table', 'stream', 'bucket', 'function', 'workflow']);
  });

  it('reads no kind from an action that only reads', () => {
    expect(kindsGranted(['sqs:ReceiveMessage', 'sqs:ListQueues', 'dynamodb:GetItem', 's3:GetObject'])).toEqual([]);
  });
});

describe('grantedIn', () => {
  it('reads one thing by its name out of its ARN', () => {
    expect(grantedIn('queue', 'arn:aws:sqs:eu-west-1:123456789012:orders')).toEqual({ name: 'orders' });
    expect(grantedIn('table', 'arn:aws:dynamodb:eu-west-1:123456789012:table/ledger')).toEqual({ name: 'ledger' });
    expect(grantedIn('function', 'arn:aws:lambda:eu-west-1:123456789012:function:place')).toEqual({ name: 'place' });
  });

  it('reads a bucket through the ARN of its objects', () => {
    expect(grantedIn('bucket', 'arn:aws:s3:::uploads/*')).toEqual({ name: 'uploads' });
    expect(grantedIn('bucket', 'arn:aws:s3:::uploads')).toEqual({ name: 'uploads' });
  });

  it('reads a wildcard as every one of the kind', () => {
    expect(grantedIn('queue', '*')).toEqual({ any: '*' });
    expect(grantedIn('queue', 'arn:aws:sqs:*')).toEqual({ any: 'arn:aws:sqs:*' });
    expect(grantedIn('queue', 'arn:aws:sqs:eu-west-1:123456789012:orders-*')).toEqual({ any: 'arn:aws:sqs:eu-west-1:123456789012:orders-*' });
    expect(grantedIn('table', 'arn:aws:dynamodb:*:*:table/*')).toEqual({ any: 'arn:aws:dynamodb:*:*:table/*' });
  });

  it('reads nothing of a kind from another service, or from a part of a table nothing writes to', () => {
    expect(grantedIn('queue', 'arn:aws:sns:eu-west-1:123456789012:orders')).toBeUndefined();
    expect(grantedIn('table', 'arn:aws:dynamodb:eu-west-1:123456789012:table/ledger/index/*')).toBeUndefined();
    expect(grantedIn('queue', 'orders')).toBeUndefined();
  });
});
