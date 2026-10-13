import { readJson } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readStateMachine, type StateMachine } from './definition.js';
import { requiredInput } from './input.js';

const machineOf = (first: Record<string, unknown>, extra: Record<string, unknown> = {}): StateMachine =>
  readStateMachine(readJson(JSON.stringify({ StartAt: 'First', States: { First: { ...first, End: true } }, ...extra })));

describe('what a workflow requires of the input it is started with', () => {
  it('is every input path its first state reads, nested where the path is', () => {
    const machine = machineOf({
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: {
        FunctionName: 'check-borrower',
        Payload: { 'borrowerId.$': '$.borrowerId', 'loan.$': '$.loan.loanId', 'token.$': '$$.Task.Token' },
        'note.$': "States.Format('{} {}', $.note, $.loan.itemId)",
      },
    });
    expect(requiredInput(machine)).toBe('{borrowerId:unknown;loan:{itemId:unknown;loanId:unknown};note:unknown}');
  });

  it('reads the parameters under the input path, and a whole-input path as nothing', () => {
    expect(requiredInput(machineOf({ Type: 'Pass', InputPath: '$.detail', Parameters: { 'id.$': '$.loanId' } }))).toBe(
      '{detail:{loanId:unknown}}',
    );
    expect(requiredInput(machineOf({ Type: 'Pass', Parameters: { 'all.$': '$' } }))).toBeUndefined();
  });

  it('requires nothing of a state that discards its input or is written in JSONata', () => {
    expect(requiredInput(machineOf({ Type: 'Pass', InputPath: null, Parameters: { 'id.$': '$.loanId' } }))).toBeUndefined();
    expect(
      requiredInput(machineOf({ Type: 'Pass', Output: '{% $states.input.loanId %}' }, { QueryLanguage: 'JSONata' })),
    ).toBeUndefined();
  });
});
