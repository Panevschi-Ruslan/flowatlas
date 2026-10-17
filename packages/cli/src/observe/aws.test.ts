import { describe, expect, it } from 'vitest';
import {
  AWS_CALLS,
  channelLabelOf,
  deployedName,
  destinationName,
  eventBusPrefixOf,
  isAwsSpan,
  readAwsSpan,
  sendsOf,
  tableChannelOf,
  type SpanAttributes,
} from './aws.js';

const ACCOUNT = '111122223333';
const arn = (service: string, rest: string): string => `arn:aws:${service}:eu-west-1:${ACCOUNT}:${rest}`;

const attrs = (text: Record<string, string>, lists: Record<string, string[]> = {}): SpanAttributes => ({
  text: new Map(Object.entries(text)),
  lists: new Map(Object.entries(lists)),
});
const sdk = (service: string, method: string, text: Record<string, string> = {}, lists: Record<string, string[]> = {}) =>
  attrs({ 'rpc.system': 'aws-api', 'rpc.service': service, 'rpc.method': method, ...text }, lists);

describe('readAwsSpan, one row of AWS_CALLS at a time', () => {
  it('reads every table a DynamoDB call names, each cut to its name', () => {
    expect(readAwsSpan(sdk('DynamoDB', 'BatchWriteItem', {}, { 'aws.dynamodb.table_names': ['orders', arn('dynamodb', 'table/audit')] }))).toMatchObject({
      awsOp: 'BatchWriteItem',
      transport: 'dynamodb',
      tables: ['orders', 'audit'],
    });
    // A stream's ARN names its table; an ARN of anything else names no table.
    expect(readAwsSpan(sdk('DynamoDB', 'GetItem', {}, { 'aws.dynamodb.table_names': [arn('dynamodb', 'table/orders/stream/2025'), arn('sqs', 'q')] })).tables).toEqual(['orders']);
    expect(readAwsSpan(sdk('DynamoDB', 'GetItem')).tables).toBeUndefined();
  });

  it('reads a queue from its URL, its ARN or its bare name', () => {
    const url = `https://sqs.eu-west-1.amazonaws.com/${ACCOUNT}/order-placed`;
    expect(readAwsSpan(sdk('SQS', 'SendMessage', { 'aws.sqs.queue.url': url }))).toMatchObject({ destination: 'order-placed', transport: 'sqs' });
    expect(readAwsSpan(sdk('SQS', 'SendMessage', { 'aws.sqs.queue_url': url })).destination).toBe('order-placed');
    expect(readAwsSpan(sdk('SQS', 'SendMessage', { 'messaging.destination.name': 'order-placed' })).destination).toBe('order-placed');
  });

  it('reads a topic, a stream and a bucket', () => {
    expect(readAwsSpan(sdk('SNS', 'Publish', { 'aws.sns.topic.arn': arn('sns', 'receipts') }))).toMatchObject({ destination: 'receipts', transport: 'sns' });
    expect(readAwsSpan(sdk('SNS', 'Publish', { 'messaging.destination.name': arn('sns', 'receipts') })).destination).toBe('receipts');
    expect(readAwsSpan(sdk('Kinesis', 'PutRecord', { 'aws.kinesis.stream_name': 'clicks' }))).toMatchObject({ destination: 'clicks', transport: 'kinesis' });
    expect(readAwsSpan(sdk('S3', 'PutObject', { 'aws.s3.bucket': 'scans' }))).toMatchObject({ destination: 'scans', transport: 's3' });
  });

  it("reads an EventBridge bus, the one an entry leaves out being 'default'", () => {
    expect(readAwsSpan(sdk('EventBridge', 'PutEvents'))).toMatchObject({ destination: 'default', transport: 'eventbridge' });
    expect(readAwsSpan(sdk('EventBridge', 'PutEvents', { 'aws.eventbridge.bus_name': arn('events', 'event-bus/shop') })).destination).toBe('shop');
  });

  it('reads the function an Invoke calls and the workflow a StartExecution starts, versions and aliases cut', () => {
    expect(readAwsSpan(sdk('Lambda', 'Invoke', { 'faas.invoked_name': 'print-label' })).invokes).toBe('print-label');
    expect(readAwsSpan(sdk('Lambda', 'Invoke', { 'aws.lambda.function.name': arn('lambda', 'function:print-label:7') })).invokes).toBe('print-label');
    expect(readAwsSpan(sdk('Lambda', 'Invoke', { 'faas.invoked_name': 'print-label:live' })).invokes).toBe('print-label');
    expect(readAwsSpan(sdk('SFN', 'StartExecution', { 'aws.step_functions.state_machine.arn': arn('states', 'stateMachine:fulfil-order') })).workflow).toBe('fulfil-order');
  });

  it('keeps every row a lookup and the operations that send', () => {
    expect(Object.keys(AWS_CALLS).sort()).toEqual(['DynamoDB', 'EventBridge', 'Kinesis', 'Lambda', 'S3', 'SFN', 'SNS', 'SQS']);
    expect([...AWS_CALLS['DynamoDB']!.sends]).toEqual(['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems']);
    expect([...AWS_CALLS['SQS']!.sends]).toEqual(['SendMessage', 'SendMessageBatch']);
    expect(AWS_CALLS['S3']!.sends.has('PutObject')).toBe(true);
    expect(sendsOf({ rpc: 'DynamoDB/GetItem', awsOp: 'GetItem' })).toBe(false);
    expect(sendsOf({ rpc: 'DynamoDB/PutItem', awsOp: 'PutItem' })).toBe(true);
    // A word every object has is not a service.
    expect(sendsOf({ rpc: 'constructor/x', awsOp: 'x' })).toBe(false);
    expect(readAwsSpan(sdk('constructor', 'x'))).toMatchObject({ awsOp: 'x' });
  });
});

describe('the function, the workflow and the step a span ran in', () => {
  it('names the function by faas.name, else by the ARN in cloud.resource_id, an alias cut', () => {
    expect(readAwsSpan(attrs({ 'faas.name': 'checkout', 'faas.trigger': 'http' }))).toMatchObject({ faas: 'checkout', trigger: 'http' });
    expect(readAwsSpan(attrs({ 'cloud.resource_id': arn('lambda', 'function:checkout:live') })).faas).toBe('checkout');
    expect(readAwsSpan(attrs({ 'aws.lambda.invoked_arn': arn('lambda', 'function:checkout:3') })).faas).toBe('checkout');
    // A trigger off the conventions' list is not kept.
    expect(readAwsSpan(attrs({ 'faas.name': 'checkout', 'faas.trigger': 'carrier-pigeon' })).trigger).toBeUndefined();
  });

  it('names a workflow from its ARN, and a step by its name, both left for the matcher to check', () => {
    expect(readAwsSpan(attrs({ 'cloud.resource_id': arn('states', 'stateMachine:fulfil-order') }))).toEqual(
      expect.objectContaining({ faas: undefined, workflow: 'fulfil-order' }),
    );
    expect(readAwsSpan(attrs({ 'cloud.resource_id': arn('states', 'stateMachine:fulfil-order'), 'aws.step_functions.state.name': 'MarkPaid' })).state).toBe('MarkPaid');
    // A bare word in cloud.resource_id is no ARN, so it names neither.
    expect(readAwsSpan(attrs({ 'cloud.resource_id': 'checkout' }))).toMatchObject({ faas: undefined, workflow: undefined });
  });

  it('says which spans it has something to read in', () => {
    expect(isAwsSpan(attrs({ 'http.route': '/orders' }))).toBe(false);
    expect(isAwsSpan(attrs({ 'faas.name': 'checkout' }))).toBe(true);
    expect(isAwsSpan(attrs({ 'messaging.system': 'aws_sqs' }))).toBe(true);
    expect(isAwsSpan(attrs({ 'messaging.system': 'kafka' }))).toBe(false);
    expect(isAwsSpan(attrs({}, { 'aws.dynamodb.table_names': ['orders'] }))).toBe(true);
  });

  it('reads a message span with no SDK call by its messaging system', () => {
    expect(readAwsSpan(attrs({ 'messaging.system': 'aws_sqs', 'messaging.destination.name': 'order-placed' }))).toMatchObject({
      transport: 'sqs',
      destination: 'order-placed',
    });
  });
});

describe('names with nothing account- or region-shaped left', () => {
  it('cuts an ARN or a URL to the name inside it, or drops it', () => {
    expect(deployedName('queue', `https://sqs.eu-west-1.amazonaws.com/${ACCOUNT}/q`)).toBe('q');
    expect(deployedName('queue', arn('sns', 't'))).toBeUndefined();
    expect(deployedName('topic', 'arn:aws:unknown')).toBeUndefined();
    expect(deployedName('topic', 'receipts')).toBe('receipts');
    expect(destinationName(arn('sns', 'receipts'))).toBe('receipts');
    expect(destinationName('https://example.invalid/a/b/c')).toBeUndefined();
    expect(destinationName('order.created')).toBe('order.created');
  });

  it('never leaves an account id or a region in what it read', () => {
    const read = readAwsSpan(
      sdk('SQS', 'SendMessage', {
        'aws.sqs.queue.url': `https://sqs.eu-west-1.amazonaws.com/${ACCOUNT}/q`,
        'cloud.resource_id': arn('lambda', 'function:checkout:live'),
      }),
    );
    expect(JSON.stringify(read)).not.toMatch(/111122223333|eu-west-1|arn:/);
  });
});

describe('channelLabelOf spells a destination the way the readers do', () => {
  it('for every transport', () => {
    expect(channelLabelOf({ destination: 'order-placed', transport: 'sqs' })).toBe('sqs/order-placed');
    expect(channelLabelOf({ destination: 'receipts', transport: 'sns' })).toBe('sns/receipts');
    expect(channelLabelOf({ destination: 'clicks', transport: 'kinesis' })).toBe('kinesis/clicks');
    expect(channelLabelOf({ destination: 'scans', transport: 's3' })).toBe('s3/scans');
    expect(channelLabelOf({ destination: 'orders', transport: 'dynamodb' })).toBe('dynamodb/orders');
    expect(tableChannelOf('orders')).toBe('dynamodb/orders');
    // A bus is many channels, and a bare name is looked up as seen.
    expect(channelLabelOf({ destination: 'shop', transport: 'eventbridge' })).toBeUndefined();
    expect(eventBusPrefixOf({ destination: 'shop', transport: 'eventbridge' })).toBe('eventbridge/shop/');
    expect(channelLabelOf({ destination: 'order.created' })).toBe('order.created');
  });
});
