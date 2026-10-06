import { REACHES_META } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readStateMachine } from './definition.js';
import { emitWorkflow, type EmitOptions, type WorkflowFragment } from './emit.js';
import { readJson } from './source.js';

const FILE = 'statemachine/holds.asl.json';

const HOLDS = {
  Comment: 'Places a hold on an item and tells the borrower when it is ready.',
  StartAt: 'PlaceHold',
  States: {
    PlaceHold: {
      Type: 'Task',
      Resource: 'arn:aws:states:::dynamodb:putItem',
      Parameters: { TableName: 'library-holds', Item: { 'itemId.$': '$.itemId' } },
      ResultPath: null,
      Retry: [{ ErrorEquals: ['States.ALL'], MaxAttempts: 2 }],
      Next: 'IsReady',
    },
    IsReady: {
      Type: 'Choice',
      Choices: [{ Variable: '$.ready', BooleanEquals: true, Next: 'NotifyBorrower' }],
      Default: 'NotifyBorrower',
    },
    NotifyBorrower: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: 'notify-borrower', 'Payload.$': '$' },
      Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Escalate' }],
      Next: 'StartReturns',
    },
    StartReturns: {
      Type: 'Task',
      Resource: 'arn:aws:states:::states:startExecution',
      Parameters: { StateMachineArn: 'arn:aws:states:eu-west-1:123456789012:stateMachine:returns' },
      Next: 'Announce',
    },
    Announce: {
      Type: 'Task',
      Resource: 'arn:aws:states:::sns:publish',
      Parameters: { TopicArn: 'arn:aws:sns:eu-west-1:123456789012:holds-ready' },
      Next: 'PickPolicy',
    },
    PickPolicy: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { 'FunctionName.$': '$.policy' },
      Next: 'ApplyPolicy',
    },
    ApplyPolicy: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: '${PolicyFunctionArn}' },
      End: true,
    },
    Escalate: { Type: 'Fail', Error: 'NotifyFailed' },
  },
};

const OPTIONS: EmitOptions = { service: 'holds', file: FILE, name: 'place-hold', nameFrom: 'deployment' };

const emit = (definition: unknown = HOLDS, options: Partial<EmitOptions> = {}): WorkflowFragment =>
  emitWorkflow(readStateMachine(readJson(JSON.stringify(definition, null, 2))), { ...OPTIONS, ...options });

const stateId = (name: string) => `holds#${FILE}:place-hold/${name}`;

describe('emitWorkflow', () => {
  const fragment = emit();
  const node = (id: string) => fragment.nodes.find((each) => each.id === id);
  const edge = (from: string, to: string) => fragment.edges.find((each) => each.from === from && each.to === to);

  it('draws the machine as a workflow entry that handles its first state', () => {
    expect(node('entry:holds:workflow:place-hold')).toEqual(
      expect.objectContaining({
        type: 'entry',
        kind: 'workflow',
        label: 'workflow place-hold',
        file: FILE,
        line: 1,
        meta: expect.objectContaining({ key: 'place-hold', name: 'place-hold', nameFrom: 'deployment', startAt: 'PlaceHold', states: 8 }),
      }),
    );
    expect(edge('entry:holds:workflow:place-hold', stateId('PlaceHold'))).toEqual(
      expect.objectContaining({ type: 'handles', confidence: 'static', file: FILE }),
    );
  });

  it('draws every state as a function of kind state, with what it was given as written', () => {
    const states = fragment.nodes.filter((each) => each.kind === 'state');
    expect(states.map((each) => each.label)).toEqual([
      'PlaceHold [Task dynamodb:putItem]',
      'IsReady [Choice]',
      'NotifyBorrower [Task lambda:invoke]',
      'StartReturns [Task states:startExecution]',
      'Announce [Task sns:publish]',
      'PickPolicy [Task lambda:invoke]',
      'ApplyPolicy [Task lambda:invoke]',
      'Escalate [Fail]',
    ]);
    expect(states.every((each) => each.type === 'function' && each.file === FILE && typeof each.line === 'number')).toBe(true);
    expect(node(stateId('PlaceHold'))?.meta).toEqual(
      expect.objectContaining({
        workflow: 'place-hold',
        stateType: 'Task',
        parameters: { TableName: 'library-holds', Item: { 'itemId.$': '$.itemId' } },
        resultPath: null,
        retry: [{ ErrorEquals: ['States.ALL'], MaxAttempts: 2 }],
        task: { kind: 'table', service: 'dynamodb', action: 'putItem', pattern: 'request-response', op: 'write', tables: ['library-holds'] },
      }),
    );
  });

  it('draws one edge per pair of states, listing every way control has between them', () => {
    expect(edge(stateId('IsReady'), stateId('NotifyBorrower'))?.meta).toEqual({
      order: 0,
      transitions: [{ kind: 'choice', rule: { Variable: '$.ready', BooleanEquals: true } }, { kind: 'default' }],
    });
    expect(edge(stateId('NotifyBorrower'), stateId('Escalate'))?.meta).toEqual({
      order: 1,
      transitions: [{ kind: 'catch', errors: ['States.ALL'] }],
    });
    expect(edge(stateId('NotifyBorrower'), stateId('StartReturns'))).toEqual(
      expect.objectContaining({ type: 'calls', confidence: 'static', meta: { order: 0, transitions: [{ kind: 'next' }] } }),
    );
  });

  it('leaves a function or a workflow named by its deployed name for the linker to join', () => {
    expect(node(stateId('NotifyBorrower'))?.meta?.[REACHES_META]).toEqual(['invoke:notify-borrower']);
    expect(node(stateId('StartReturns'))?.meta?.[REACHES_META]).toEqual(['workflow:returns']);
    expect(fragment.edges.some((each) => each.to.startsWith('entry:') && each.type === 'calls')).toBe(false);
  });

  it('draws a task on a table as a query on that table', () => {
    const query = fragment.nodes.find((each) => each.type === 'db_query');
    expect(query).toEqual(
      expect.objectContaining({ label: 'write library-holds', meta: expect.objectContaining({ op: 'write', table: 'library-holds' }) }),
    );
    expect(edge(stateId('PlaceHold'), query?.id ?? '')).toEqual(expect.objectContaining({ type: 'calls' }));
    expect(edge(query?.id ?? '', 'table:holds#library-holds')).toEqual(expect.objectContaining({ type: 'queries' }));
  });

  it('writes a row for each target it could not join, by why, and draws no edge for it', () => {
    expect(fragment.rows.map((row) => [row.reason, row.level ?? 'action', row.symbol])).toEqual([
      ['workflow-channel-not-joined', 'info', stateId('Announce')],
      ['workflow-target-dynamic', 'info', stateId('PickPolicy')],
      ['workflow-template-unbound', 'action', stateId('ApplyPolicy')],
    ]);
    expect(fragment.rows[2]?.meta).toEqual(
      expect.objectContaining({ field: 'FunctionName', variables: ['PolicyFunctionArn'] }),
    );
    expect(node(stateId('PickPolicy'))?.meta?.[REACHES_META]).toBeUndefined();
    expect(node(stateId('ApplyPolicy'))?.meta?.[REACHES_META]).toBeUndefined();
  });

  it('joins a placeholder once it is given what the placeholder stands for', () => {
    const filled = emit(HOLDS, {
      resolve: (name) => (name === 'PolicyFunctionArn' ? 'arn:aws:lambda:eu-west-1:123456789012:function:hold-policy' : undefined),
    });
    expect(filled.nodes.find((each) => each.id === stateId('ApplyPolicy'))?.meta?.[REACHES_META]).toEqual(['invoke:hold-policy']);
    expect(filled.rows.some((row) => row.reason === 'workflow-template-unbound')).toBe(false);
  });

  it('says when the name is only the file name, and makes a join on it heuristic', () => {
    const named = emit(HOLDS, { nameFrom: 'file-name' });
    expect(named.nodes[0]?.meta).toEqual(expect.objectContaining({ nameFrom: 'file-name', nameConfidence: 'heuristic' }));
    expect(named.rows[0]).toEqual(expect.objectContaining({ reason: 'workflow-named-by-file', level: 'info' }));
  });

  it('draws nothing but a row for a document that is not a state machine', () => {
    const refused = emit({ Version: '2012-10-17', Statement: [] });
    expect(refused.nodes).toEqual([]);
    expect(refused.edges).toEqual([]);
    expect(refused.rows.map((row) => row.reason)).toEqual(['workflow-definition-unreadable']);
  });

  it('draws what a definition the service would refuse says, and a row naming what is wrong', () => {
    const broken = emit({ StartAt: 'A', States: { A: { Type: 'Pass', Next: 'Gone' } } });
    expect(broken.nodes.map((each) => each.id)).toEqual(['entry:holds:workflow:place-hold', stateId('A')]);
    expect(broken.edges.filter((each) => each.type === 'calls')).toEqual([]);
    expect(broken.rows).toEqual([expect.objectContaining({ reason: 'workflow-definition-invalid', symbol: stateId('A') })]);
  });

  it('is a function of its input alone', () => {
    expect(emit()).toEqual(fragment);
  });
});
