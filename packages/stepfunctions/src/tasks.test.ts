import { describe, expect, it } from 'vitest';
import type { State } from './definition.js';
import { classifyTask, TASK_CLASSIFIERS, type Task } from './tasks.js';
import { functionName, queueName, readText, stateMachineName, tableName, type TemplateValues } from './values.js';

const task = (fields: Record<string, unknown>): State => ({
  name: 'Step',
  type: 'Task',
  scope: [],
  queryLanguage: 'JSONPath',
  end: true,
  transitions: [],
  fields: { Type: 'Task', ...fields },
  path: ['States', 'Step'],
});

const classify = (fields: Record<string, unknown>, values?: TemplateValues): Task => classifyTask(task(fields), values);

const read = (value: string) => ({ read: true, value });

describe('a function the task invokes', () => {
  const invoke = (functionName: unknown) =>
    classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: functionName } });

  it.each([
    ['a name', 'notify-borrower'],
    ['a name with an alias', 'notify-borrower:live'],
    ['a partial ARN', '123456789012:function:notify-borrower'],
    ['a partial ARN with a version', '123456789012:function:notify-borrower:7'],
    ['a full ARN', 'arn:aws:lambda:eu-west-1:123456789012:function:notify-borrower'],
    ['a full ARN in another partition, with an alias', 'arn:aws-us-gov:lambda:us-gov-west-1:123456789012:function:notify-borrower:live'],
  ])('reads the function name from %s', (_label, written) => {
    const found = invoke(written);
    expect(found.kind).toBe('function');
    expect(found.kind === 'function' && found.name).toEqual(expect.objectContaining(read('notify-borrower')));
    expect(found.call).toEqual({ service: 'lambda', action: 'invoke', pattern: 'request-response', sdk: false });
  });

  it('reads the function named as the resource itself', () => {
    const found = classify({ Resource: 'arn:aws:lambda:eu-west-1:123456789012:function:score-borrower:live' });
    expect(found).toEqual({ kind: 'function', name: expect.objectContaining(read('score-borrower')) });
  });

  it('reads the SDK integration and the task-token form the same way', () => {
    const sdk = classify({ Resource: 'arn:aws:states:::aws-sdk:lambda:invoke', Parameters: { FunctionName: 'notify-borrower' } });
    expect(sdk.call?.sdk).toBe(true);
    expect(sdk.kind === 'function' && sdk.name.read).toBe(true);
    const waiting = classify({
      Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
      Parameters: { FunctionName: 'notify-borrower', 'Payload.$': '$' },
    });
    expect(waiting.call?.pattern).toBe('wait-for-task-token');
  });

  it('reads another action on the service as a call on the service', () => {
    expect(classify({ Resource: 'arn:aws:states:::aws-sdk:lambda:listFunctions' })).toEqual({
      kind: 'service',
      call: { service: 'lambda', action: 'listFunctions', pattern: 'request-response', sdk: true },
    });
  });
});

describe('a name that cannot be read before the machine runs', () => {
  const nameOf = (found: Task) => (found.kind === 'function' ? found.name : undefined);

  it('is a path when written under a .$ key', () => {
    const found = classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { 'FunctionName.$': '$.handler' } });
    expect(nameOf(found)).toEqual({ read: false, cause: 'jsonpath', written: '$.handler' });
  });

  it('is an intrinsic when a States function builds it', () => {
    const found = classify({
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { 'FunctionName.$': "States.Format('notify-{}', $.channel)" },
    });
    expect(nameOf(found)).toEqual(expect.objectContaining({ read: false, cause: 'intrinsic' }));
  });

  it('is JSONata when written as an expression', () => {
    const found = classify({
      Resource: 'arn:aws:states:::lambda:invoke',
      Arguments: { FunctionName: '{% $states.input.handler %}' },
    });
    expect(nameOf(found)).toEqual(expect.objectContaining({ read: false, cause: 'jsonata' }));
  });

  it('is the whole of the parameters when they are one expression', () => {
    const path = classify({ Resource: 'arn:aws:states:::lambda:invoke', 'Parameters.$': '$.request' });
    expect(nameOf(path)).toEqual(expect.objectContaining({ read: false, cause: 'jsonpath', written: '$.request' }));
    const jsonata = classify({ Resource: 'arn:aws:states:::lambda:invoke', Arguments: '{% $states.input %}' });
    expect(nameOf(jsonata)).toEqual(expect.objectContaining({ read: false, cause: 'jsonata' }));
  });

  it('is a template placeholder nothing filled, naming the variable', () => {
    const found = classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: '${NotifyFunctionArn}' } });
    expect(nameOf(found)).toEqual({
      read: false,
      cause: 'template',
      written: '${NotifyFunctionArn}',
      variables: ['NotifyFunctionArn'],
    });
  });

  it('is read once whatever deploys the definition fills the placeholder', () => {
    const values: TemplateValues = (name) =>
      name === 'NotifyFunctionArn' ? 'arn:aws:lambda:eu-west-1:123456789012:function:notify-borrower' : undefined;
    const found = classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: '${NotifyFunctionArn}' } }, values);
    expect(nameOf(found)).toEqual(expect.objectContaining(read('notify-borrower')));
  });

  it('is still read when only the region and account are placeholders', () => {
    const found = classify({
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:notify-borrower' },
    });
    expect(nameOf(found)).toEqual(expect.objectContaining(read('notify-borrower')));
  });

  it('is not read when the placeholder is part of the name', () => {
    const found = classify({
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: 'notify-${stage}' },
    });
    expect(nameOf(found)).toEqual(expect.objectContaining({ read: false, cause: 'template', variables: ['stage'] }));
  });

  it('says so when the field is missing or names nothing', () => {
    expect(nameOf(classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: {} }))).toEqual(
      expect.objectContaining({ read: false, cause: 'absent' }),
    );
    expect(nameOf(classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'not a name' } }))).toEqual(
      expect.objectContaining({ read: false, cause: 'not-a-name' }),
    );
    expect(nameOf(classify({ Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 42 } }))).toEqual(
      expect.objectContaining({ read: false, cause: 'not-text' }),
    );
  });
});

describe('another workflow the task starts', () => {
  it.each([
    ['arn:aws:states:::states:startExecution', 'request-response'],
    ['arn:aws:states:::states:startExecution.sync', 'sync'],
    ['arn:aws:states:::states:startExecution.sync:2', 'sync:2'],
    ['arn:aws:states:::states:startExecution.waitForTaskToken', 'wait-for-task-token'],
  ])('reads %s', (resource, pattern) => {
    const found = classify({
      Resource: resource,
      Parameters: { StateMachineArn: 'arn:aws:states:eu-west-1:123456789012:stateMachine:borrower-notifications' },
    });
    expect(found.kind).toBe('workflow');
    expect(found.kind === 'workflow' && found.name).toEqual(expect.objectContaining(read('borrower-notifications')));
    expect(found.call?.pattern).toBe(pattern);
  });

  it('reads the SDK spelling of the service', () => {
    const found = classify({
      Resource: 'arn:aws:states:::aws-sdk:sfn:startSyncExecution',
      Parameters: { StateMachineArn: 'arn:aws:states:eu-west-1:123456789012:stateMachine:borrower-notifications:prod' },
    });
    expect(found.kind === 'workflow' && found.name).toEqual(expect.objectContaining(read('borrower-notifications')));
  });
});

describe('a message the task sends', () => {
  it('reads a queue from its URL', () => {
    const found = classify({
      Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken',
      Parameters: { QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/librarian-approvals', MessageBody: {} },
    });
    expect(found).toEqual(
      expect.objectContaining({
        kind: 'channel',
        transport: 'queue',
        targets: [{ name: expect.objectContaining(read('librarian-approvals')), payload: { MessageBody: {} } }],
      }),
    );
  });

  it('reads a topic from its ARN', () => {
    const found = classify({
      Resource: 'arn:aws:states:::sns:publish',
      Parameters: { TopicArn: 'arn:aws:sns:eu-west-1:123456789012:loan-decisions.fifo', 'Message.$': '$' },
    });
    expect(found).toEqual(
      expect.objectContaining({
        transport: 'topic',
        targets: [{ name: expect.objectContaining(read('loan-decisions.fifo')), payload: { 'Message.$': '$' } }],
      }),
    );
  });

  it('reads one channel per event put on a bus, the default bus by name', () => {
    const found = classify({
      Resource: 'arn:aws:states:::events:putEvents',
      Parameters: {
        Entries: [
          { EventBusName: 'arn:aws:events:eu-west-1:123456789012:event-bus/library-events', Source: 'library.circulation', DetailType: 'LoanApproved' },
          { Source: 'library.circulation', 'DetailType.$': '$.kind' },
        ],
      },
    });
    expect(found.kind).toBe('channel');
    if (found.kind !== 'channel') return;
    expect(found.targets.map((target) => [target.name.read && target.name.value, target.detailType?.read])).toEqual([
      ['library-events', true],
      ['default', false],
    ]);
  });

  it('reads entries written as one path as one target nobody could read', () => {
    const found = classify({ Resource: 'arn:aws:states:::events:putEvents', Parameters: { 'Entries.$': '$.events' } });
    expect(found.kind === 'channel' && found.targets).toEqual([{ name: expect.objectContaining({ read: false, cause: 'jsonpath' }) }]);
  });
});

describe('a table the task reads or writes', () => {
  it.each([
    ['arn:aws:states:::dynamodb:getItem', 'read'],
    ['arn:aws:states:::dynamodb:putItem', 'write'],
    ['arn:aws:states:::dynamodb:updateItem', 'write'],
    ['arn:aws:states:::dynamodb:deleteItem', 'delete'],
    ['arn:aws:states:::aws-sdk:dynamodb:query', 'read'],
    ['arn:aws:states:::aws-sdk:dynamodb:scan', 'read'],
  ])('reads %s as a %s of the table', (resource, op) => {
    expect(classify({ Resource: resource, Parameters: { TableName: 'library-loans' } })).toEqual(
      expect.objectContaining({ kind: 'table', op, tables: [expect.objectContaining(read('library-loans'))] }),
    );
  });

  it('reads a table named by its ARN', () => {
    const found = classify({
      Resource: 'arn:aws:states:::dynamodb:getItem',
      Parameters: { TableName: 'arn:aws:dynamodb:eu-west-1:123456789012:table/library-holds' },
    });
    expect(found.kind === 'table' && found.tables).toEqual([expect.objectContaining(read('library-holds'))]);
  });

  it('reads every table of a batch and of a transaction', () => {
    const batch = classify({
      Resource: 'arn:aws:states:::aws-sdk:dynamodb:batchWriteItem',
      Parameters: { RequestItems: { 'library-loans': [], 'library-holds.$': '$.holds' } },
    });
    expect(batch.kind === 'table' && batch.tables.map((each) => each.read && each.value)).toEqual(['library-loans', 'library-holds']);
    const transaction = classify({
      Resource: 'arn:aws:states:::aws-sdk:dynamodb:transactWriteItems',
      Parameters: {
        TransactItems: [{ Put: { TableName: 'library-loans' } }, { Delete: { TableName: 'library-holds' } }],
      },
    });
    expect(transaction.kind === 'table' && transaction.tables.map((each) => each.read && each.value)).toEqual([
      'library-loans',
      'library-holds',
    ]);
  });

  it('reads an operation on the table itself as a call on the service', () => {
    expect(classify({ Resource: 'arn:aws:states:::aws-sdk:dynamodb:describeTable', Parameters: { TableName: 'library-loans' } }).kind).toBe('service');
  });
});

describe('every other task', () => {
  it('keeps the service and the action of an integration nothing joins', () => {
    expect(classify({ Resource: 'arn:aws:states:::aws-sdk:s3:putObject', Parameters: { Bucket: 'library-archive' } })).toEqual({
      kind: 'service',
      call: { service: 's3', action: 'putObject', pattern: 'request-response', sdk: true },
    });
    expect(classify({ Resource: 'arn:aws:states:::glue:startJobRun.sync' })).toEqual({
      kind: 'service',
      call: { service: 'glue', action: 'startJobRun', pattern: 'sync', sdk: false },
    });
  });

  it('reads an activity by its name', () => {
    expect(classify({ Resource: 'arn:aws:states:eu-west-1:123456789012:activity:librarian-review' })).toEqual({
      kind: 'activity',
      name: expect.objectContaining(read('librarian-review')),
    });
  });

  it('keeps a resource it does not recognise, and one it could not read', () => {
    expect(classify({ Resource: 'urn:something:else' })).toEqual({
      kind: 'unknown',
      resource: expect.objectContaining({ read: true, value: 'urn:something:else' }),
    });
    expect(classify({ Resource: '${ScanFunctionArn}' })).toEqual({
      kind: 'unknown',
      resource: expect.objectContaining({ read: false, cause: 'template' }),
    });
  });
});

describe('the registry', () => {
  it('has one classifier per service', () => {
    const services = TASK_CLASSIFIERS.flatMap((classifier) => classifier.services);
    expect(new Set(services).size).toBe(services.length);
  });
});

describe('names out of what a field holds', () => {
  it('reads each kind of name and refuses what names none', () => {
    expect(functionName('arn:aws:sqs:eu-west-1:123456789012:returns')).toBeUndefined();
    expect(stateMachineName('borrower-notifications')).toBeUndefined();
    expect(queueName('arn:aws:sqs:eu-west-1:123456789012:returns')).toBe('returns');
    expect(tableName('library loans')).toBeUndefined();
  });

  it('reads text without placeholders as it is', () => {
    expect(readText('library-loans')).toEqual({ read: true, value: 'library-loans', written: 'library-loans' });
  });
});
