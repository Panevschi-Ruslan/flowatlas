import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readerFor } from './index.js';
import { sfnHistoryReader } from './sfn-history.js';
import { NameNeeded } from './shared.js';

const exports = join(dirname(fileURLToPath(import.meta.url)), '../../../../../fixtures/lambda-traces/exports');
const history = JSON.parse(readFileSync(join(exports, 'fulfil-order.history.json'), 'utf8')) as Record<string, unknown>;
const read = sfnHistoryReader.read(history);
const span = (id: string) => read.spans.find((one) => one.spanId === id)!;

const PLANTED = ['planted', '111122223333', 'eu-west-1', 'arn:', 'roleArn', 'shop-workflows', 'orderId', 'TableName', 'TopicArn'];

/** A history of events written out as the CLI prints them, one second apart, each after the one before. */
const events = (...types: Array<[type: string, details?: Record<string, unknown>]>) =>
  types.map(([type, details], index) => ({
    id: index + 1,
    previousEventId: index,
    type,
    timestamp: `2025-10-16T08:30:0${index}.000000+00:00`,
    ...(details === undefined ? {} : details),
  }));
const entered = (name: string) => ({ stateEnteredEventDetails: { name, input: '{"card":"planted"}' } });
const exited = (name: string) => ({ stateExitedEventDetails: { name, output: '{"card":"planted"}' } });

describe('the Step Functions history reader', () => {
  it('reads get-execution-history output, and is not taken for a log export', () => {
    expect(readerFor(history)).toBe(sfnHistoryReader);
    expect(readerFor({ events: [{ timestamp: 1, message: 'REPORT RequestId: x' }] })).not.toBe(sfnHistoryReader);
  });

  it('reads the run as one span on the workflow, from started to succeeded, its name the trace id', () => {
    expect(span('1')).toEqual({
      traceId: 'run-0001',
      spanId: '1',
      kind: 'server',
      service: 'fulfil-order',
      workflow: 'fulfil-order',
      at: '2025-10-16T08:30:00.075Z',
      durationMs: 825,
    });
  });

  it('reads each step entered and exited as a span with its duration, under the run', () => {
    const steps = read.spans.filter((one) => one.state !== undefined);
    expect(steps.map(({ state, durationMs, parentId }) => [state, durationMs, parentId])).toEqual([
      ['ReserveStock', 220, '1'],
      ['ChargeCard', 290, '1'],
      ['MarkPaid', 90, '1'],
      ['SendReceipt', 180, '1'],
    ]);
  });

  it('reads the function a step invoked by its ARN, and a service integration by its operation only', () => {
    expect(span('8')).toMatchObject({ kind: 'client', rpc: 'Lambda/Invoke', awsOp: 'Invoke', invokes: 'charge-card', parentId: '7', durationMs: 283 });
    // `parameters` is never read: the call names no function, table or topic.
    expect(span('3')).toEqual(expect.objectContaining({ rpc: 'Lambda/Invoke', awsOp: 'Invoke', parentId: '2' }));
    expect(span('3')).not.toHaveProperty('invokes');
    expect(span('13')).toMatchObject({ rpc: 'DynamoDB/UpdateItem', awsOp: 'UpdateItem', durationMs: 87 });
    expect(span('13')).not.toHaveProperty('tables');
    expect(span('18')).toMatchObject({ rpc: 'SNS/Publish' });
    expect(span('18')).not.toHaveProperty('destination');
  });

  it('flags the step, the call and the run a failure happened in, never its text', () => {
    const failed = sfnHistoryReader.read(
      {
        events: events(
          ['ExecutionStarted'],
          ['TaskStateEntered', entered('ChargeCard')],
          ['LambdaFunctionScheduled', { lambdaFunctionScheduledEventDetails: { resource: 'arn:aws:lambda:eu-west-1:111122223333:function:charge-card' } }],
          ['LambdaFunctionStarted'],
          ['LambdaFunctionFailed', { lambdaFunctionFailedEventDetails: { error: 'CardDeclined', cause: 'declined for planted-customer' } }],
          ['ExecutionFailed', { executionFailedEventDetails: { error: 'CardDeclined', cause: 'planted' } }],
        ),
      },
      undefined,
      { workflow: 'fulfil-order' },
    );
    expect(failed.spans.map(({ spanId, state, rpc, durationMs, error }) => ({ spanId, state, rpc, durationMs, error }))).toEqual([
      { spanId: '1', state: undefined, rpc: undefined, durationMs: 5000, error: true },
      // Entered and never exited: no duration.
      { spanId: '2', state: 'ChargeCard', rpc: undefined, durationMs: undefined, error: true },
      { spanId: '3', state: undefined, rpc: 'Lambda/Invoke', durationMs: 2000, error: true },
    ]);
    expect(JSON.stringify(failed)).not.toContain('Declined');
    for (const type of ['ExecutionTimedOut', 'ExecutionAborted']) {
      const ended = sfnHistoryReader.read({ events: events(['ExecutionStarted'], [type]) }, undefined, { workflow: 'w' });
      expect(ended.spans[0]).toMatchObject({ error: true, durationMs: 1000 });
    }
  });

  it("reads a Map state's iterations as one span each, on the one step, paired by the chain of events", () => {
    // Two iterations of `Pack` interleaved: the chain, not the order, says which exit closes which entry.
    const map = sfnHistoryReader.read(
      {
        stateMachineArn: 'arn:aws:states:eu-west-1:111122223333:stateMachine:fulfil-order:live',
        events: [
          { id: 1, previousEventId: 0, type: 'ExecutionStarted', timestamp: 1760603400 },
          { id: 2, previousEventId: 1, type: 'MapStateEntered', timestamp: 1760603401, stateEnteredEventDetails: { name: 'PackAll' } },
          { id: 3, previousEventId: 2, type: 'MapStateStarted', timestamp: 1760603401 },
          { id: 4, previousEventId: 3, type: 'MapIterationStarted', timestamp: 1760603401 },
          { id: 5, previousEventId: 3, type: 'MapIterationStarted', timestamp: 1760603401 },
          { id: 6, previousEventId: 4, type: 'PassStateEntered', timestamp: 1760603402, stateEnteredEventDetails: { name: 'Pack' } },
          { id: 7, previousEventId: 5, type: 'PassStateEntered', timestamp: 1760603403, stateEnteredEventDetails: { name: 'Pack' } },
          { id: 8, previousEventId: 6, type: 'PassStateExited', timestamp: 1760603406, stateExitedEventDetails: { name: 'Pack' } },
          { id: 9, previousEventId: 7, type: 'PassStateExited', timestamp: 1760603404, stateExitedEventDetails: { name: 'Pack' } },
          { id: 10, previousEventId: 9, type: 'MapStateSucceeded', timestamp: 1760603407 },
          { id: 11, previousEventId: 10, type: 'MapStateExited', timestamp: 1760603407, stateExitedEventDetails: { name: 'PackAll' } },
          { id: 12, previousEventId: 11, type: 'ExecutionSucceeded', timestamp: 1760603408 },
        ],
      },
      undefined,
    );
    expect(map.spans.map(({ spanId, state, durationMs, parentId }) => [spanId, state, durationMs, parentId])).toEqual([
      ['1', undefined, 8000, undefined],
      ['2', 'PackAll', 6000, '1'],
      ['6', 'Pack', 4000, '2'],
      ['7', 'Pack', 1000, '2'],
    ]);
    // Named by the alias ARN, the alias cut; no execution name, so the trace is the run's start.
    expect(map.spans[0]).toMatchObject({ workflow: 'fulfil-order', traceId: 'fulfil-order@2025-10-16T08:30:00.000Z' });
  });

  it('takes the workflow from describe-execution, from the version ARN the start carries, then from --workflow', () => {
    const bare = { events: events(['ExecutionStarted'], ['ExecutionSucceeded']) };
    expect(sfnHistoryReader.read({ ...bare, executionArn: 'arn:aws:states:eu-west-1:111122223333:execution:returns:r-1' }).spans[0]).toMatchObject({
      workflow: 'returns',
      traceId: 'r-1',
    });
    const versioned = {
      events: events(
        ['ExecutionStarted', { executionStartedEventDetails: { stateMachineVersionArn: 'arn:aws:states:eu-west-1:111122223333:stateMachine:returns:3' } }],
        ['ExecutionSucceeded'],
      ),
    };
    expect(sfnHistoryReader.read(versioned, undefined, { workflow: 'other' }).spans[0]).toMatchObject({ workflow: 'returns' });
    expect(sfnHistoryReader.read(bare, 'shop', { workflow: 'returns' }).spans[0]).toMatchObject({ workflow: 'returns', service: 'shop' });
  });

  it('refuses a history that names no state machine, with the flag that names it', () => {
    const bare = { events: events(['ExecutionStarted'], ['ExecutionSucceeded']) };
    expect(() => sfnHistoryReader.read(bare)).toThrow(NameNeeded);
    try {
      sfnHistoryReader.read(bare);
    } catch (cause) {
      expect((cause as NameNeeded).flag).toBe('--workflow');
    }
  });

  it('keeps no input, output, parameter, cause, role ARN, account or region', () => {
    const text = JSON.stringify(read);
    for (const secret of PLANTED) expect(text, secret).not.toContain(secret);
    expect(read.droppedAttributes).toBeGreaterThan(30);
  });
});
