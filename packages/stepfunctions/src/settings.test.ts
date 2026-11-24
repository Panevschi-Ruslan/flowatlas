import { DEPLOYMENT_SETTING_FINDINGS, readJson } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readStateMachine } from './definition.js';
import { emitWorkflow } from './emit.js';

const draw = (definition: unknown) =>
  emitWorkflow(readStateMachine(readJson(JSON.stringify(definition, null, 2))), {
    service: 'shop',
    file: 'statemachine/fulfil.asl.json',
    name: 'fulfil',
    nameFrom: 'deployment',
  });

const settingRows = (definition: unknown) =>
  draw(definition)
    .rows.filter((row) => DEPLOYMENT_SETTING_FINDINGS.includes(row.reason))
    .map((row) => `${row.reason} ${String(row.symbol).split(':').pop()} ${row.level ?? 'action'}`);

const machine = (states: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ StartAt: Object.keys(states)[0], States: states, ...extra });

const TRANSIENT = ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException'];

describe('what a task state leaves unsaid (P389)', () => {
  it('says a task invoking a function that retries no transient error, by the integration or the function ARN', () => {
    expect(
      settingRows(
        machine({
          Integration: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'reserve' }, Next: 'ByArn' },
          ByArn: { Type: 'Task', Resource: 'arn:aws:lambda:eu-west-1:000000000000:function:charge', Next: 'OnlyTimeout' },
          OnlyTimeout: {
            Type: 'Task',
            Resource: 'arn:aws:states:::lambda:invoke',
            Parameters: { FunctionName: 'reserve' },
            Retry: [{ ErrorEquals: ['States.Timeout'] }],
            End: true,
          },
        }),
      ),
    ).toEqual([
      'workflow-lambda-unretried fulfil/Integration action',
      'workflow-lambda-unretried fulfil/ByArn action',
      'workflow-lambda-unretried fulfil/OnlyTimeout action',
    ]);
  });

  it('says nothing of a function task retrying the transient errors or a wildcard, and says a caught one at info', () => {
    expect(
      settingRows(
        machine({
          Named: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'a' }, Retry: [{ ErrorEquals: TRANSIENT }], Next: 'Wildcard' },
          Wildcard: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'a' }, Retry: [{ ErrorEquals: ['States.ALL'] }], Next: 'Caught' },
          Caught: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'a' }, Catch: [{ ErrorEquals: ['States.TaskFailed'], Next: 'Done' }], Next: 'Done' },
          Done: { Type: 'Succeed' },
        }),
      ),
    ).toEqual(['workflow-lambda-unretried fulfil/Caught info']);
  });

  it('says a task waiting on an activity, a job or a token with no timeout, and a token with no heartbeat', () => {
    expect(
      settingRows(
        machine({
          Activity: { Type: 'Task', Resource: 'arn:aws:states:eu-west-1:000000000000:activity:pack', Next: 'Job' },
          Job: { Type: 'Task', Resource: 'arn:aws:states:::ecs:runTask.sync', Parameters: { Cluster: 'c' }, Next: 'Token' },
          Token: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken', Parameters: { QueueUrl: 'q', MessageBody: {} }, Next: 'Timed' },
          Timed: {
            Type: 'Task',
            Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken',
            Parameters: { QueueUrl: 'q', MessageBody: {} },
            TimeoutSecondsPath: '$.wait',
            HeartbeatSeconds: 60,
            Next: 'Quick',
          },
          Quick: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage', Parameters: { QueueUrl: 'q', MessageBody: {} }, End: true },
        }),
      ),
    ).toEqual([
      'workflow-task-untimed fulfil/Activity action',
      'workflow-task-untimed fulfil/Job action',
      'workflow-task-untimed fulfil/Token action',
      'workflow-callback-no-heartbeat fulfil/Token info',
    ]);
  });

  it('takes a state machine timeout as bounding every task, and still asks a callback for a heartbeat', () => {
    expect(
      settingRows(
        machine(
          { Token: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage.waitForTaskToken', Parameters: { QueueUrl: 'q', MessageBody: {} }, End: true } },
          { TimeoutSeconds: 3600 },
        ),
      ),
    ).toEqual(['workflow-callback-no-heartbeat fulfil/Token info']);
  });

  it('reads tasks nested in a parallel branch and a map', () => {
    expect(
      settingRows(
        machine({
          Fan: {
            Type: 'Parallel',
            Branches: [machine({ Inner: { Type: 'Task', Resource: 'arn:aws:states:eu-west-1:000000000000:activity:pick', TimeoutSeconds: 60, End: true } })],
            Next: 'Each',
          },
          Each: {
            Type: 'Map',
            ItemProcessor: machine({ Item: { Type: 'Task', Resource: 'arn:aws:states:::lambda:invoke', Parameters: { FunctionName: 'f' }, End: true } }),
            End: true,
          },
        }),
      ),
    ).toEqual(['workflow-lambda-unretried fulfil/Item action']);
  });
});
