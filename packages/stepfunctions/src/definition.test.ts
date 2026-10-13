import { describe, expect, it } from 'vitest';
import { readStateMachine, STATE_TYPES, type StateMachine } from './definition.js';
import { readJson, readYaml } from '@flowatlas/core';

const machineOf = (value: unknown): StateMachine => readStateMachine(readJson(JSON.stringify(value, null, 2)));

/** A loan's return: every state type, every way control moves between states. */
const RETURNS = {
  Comment: 'Takes a returned item back into the collection.',
  StartAt: 'ScanItem',
  States: {
    ScanItem: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: 'scan-returned-item' },
      Retry: [{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 2 }],
      Catch: [{ ErrorEquals: ['ItemUnknown'], Next: 'FlagForStaff' }],
      Next: 'IsLate',
    },
    IsLate: {
      Type: 'Choice',
      Choices: [
        { Variable: '$.daysLate', NumericGreaterThan: 0, Next: 'ChargeLateFee' },
        { And: [{ Variable: '$.damaged', BooleanEquals: true }], Next: 'FlagForStaff' },
      ],
      Default: 'Shelve',
    },
    ChargeLateFee: { Type: 'Pass', Result: { fee: 1 }, ResultPath: '$.fee', Next: 'Shelve' },
    Shelve: {
      Type: 'Parallel',
      Branches: [
        { StartAt: 'UpdateCatalogue', States: { UpdateCatalogue: { Type: 'Pass', End: true } } },
        {
          StartAt: 'ReleaseHolds',
          States: {
            ReleaseHolds: {
              Type: 'Map',
              ItemProcessor: {
                StartAt: 'NotifyHolder',
                States: { NotifyHolder: { Type: 'Wait', Seconds: 1, End: true } },
              },
              End: true,
            },
          },
        },
      ],
      Next: 'Returned',
    },
    FlagForStaff: { Type: 'Fail', Error: 'NeedsStaff' },
    Returned: { Type: 'Succeed' },
  },
};

describe('readStateMachine', () => {
  const machine = machineOf(RETURNS);

  it('lists every state, nested ones straight after the state that holds them', () => {
    expect(machine.states.map((state) => state.name)).toEqual([
      'ScanItem',
      'IsLate',
      'ChargeLateFee',
      'Shelve',
      'UpdateCatalogue',
      'ReleaseHolds',
      'NotifyHolder',
      'FlagForStaff',
      'Returned',
    ]);
    expect(machine.problems).toEqual([]);
    expect(machine.startAt).toBe('ScanItem');
    expect(machine.comment).toBe('Takes a returned item back into the collection.');
  });

  it('covers every type of state the language has', () => {
    expect(new Set(machine.states.map((state) => state.type))).toEqual(new Set(STATE_TYPES));
  });

  it('says which containers a nested state is in, outermost first', () => {
    const scopes = Object.fromEntries(machine.states.map((state) => [state.name, state.scope]));
    expect(scopes['ScanItem']).toEqual([]);
    expect(scopes['UpdateCatalogue']).toEqual(['Shelve[0]']);
    expect(scopes['NotifyHolder']).toEqual(['Shelve[1]', 'ReleaseHolds']);
  });

  it('reads each way control moves, with what each says about itself', () => {
    const of = (name: string) => machine.states.find((state) => state.name === name)?.transitions;
    expect(of('ScanItem')).toEqual([
      expect.objectContaining({ kind: 'next', to: 'IsLate' }),
      expect.objectContaining({ kind: 'catch', to: 'FlagForStaff', errors: ['ItemUnknown'] }),
    ]);
    expect(of('IsLate')?.map((each) => [each.kind, each.to])).toEqual([
      ['choice', 'ChargeLateFee'],
      ['choice', 'FlagForStaff'],
      ['default', 'Shelve'],
    ]);
    expect(of('IsLate')?.[0]?.rule).toEqual({ Variable: '$.daysLate', NumericGreaterThan: 0 });
    expect(of('Shelve')?.map((each) => [each.kind, each.to, each.branch])).toEqual([
      ['branch', 'UpdateCatalogue', 0],
      ['branch', 'ReleaseHolds', 1],
      ['next', 'Returned', undefined],
    ]);
    expect(of('ReleaseHolds')).toEqual([
      expect.objectContaining({ kind: 'item-processor', to: 'NotifyHolder', field: 'ItemProcessor' }),
    ]);
  });

  it('keeps where each transition is written', () => {
    const scan = machine.states.find((state) => state.name === 'ScanItem');
    const next = scan?.transitions.find((each) => each.kind === 'next');
    expect(next?.position?.line).toBeGreaterThan(scan?.position?.line ?? Number.MAX_SAFE_INTEGER);
  });

  it('keeps Retry as written, on the state rather than as a transition', () => {
    const scan = machine.states.find((state) => state.name === 'ScanItem');
    expect(scan?.fields['Retry']).toEqual([{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 2 }]);
    expect(scan?.transitions.some((each) => each.to === 'ScanItem')).toBe(false);
  });

  it('marks the states that end an execution', () => {
    const ends = machine.states.filter((state) => state.end).map((state) => state.name);
    expect(ends).toEqual(['UpdateCatalogue', 'ReleaseHolds', 'NotifyHolder', 'FlagForStaff', 'Returned']);
  });

  it('reads the older name for a map processor', () => {
    const legacy = machineOf({
      StartAt: 'Each',
      States: {
        Each: { Type: 'Map', Iterator: { StartAt: 'One', States: { One: { Type: 'Pass', End: true } } }, End: true },
      },
    });
    expect(legacy.states.map((state) => state.name)).toEqual(['Each', 'One']);
    expect(legacy.states[0]?.transitions[0]).toEqual(expect.objectContaining({ kind: 'item-processor', field: 'Iterator' }));
  });

  it('lets a state change the language its fields are written in, and its children inherit it', () => {
    const mixed = machineOf({
      QueryLanguage: 'JSONata',
      StartAt: 'A',
      States: {
        A: { Type: 'Pass', QueryLanguage: 'JSONPath', Next: 'B' },
        B: { Type: 'Map', ItemProcessor: { StartAt: 'C', States: { C: { Type: 'Pass', End: true } } }, End: true },
      },
    });
    expect(mixed.states.map((state) => state.queryLanguage)).toEqual(['JSONPath', 'JSONata', 'JSONata']);
  });

  it('reads a definition written in YAML the same way', () => {
    const yaml = readStateMachine(
      readYaml(['StartAt: Hold', 'States:', '  Hold:', '    Type: Wait', '    Seconds: 5', '    Next: Done', '  Done:', '    Type: Succeed'].join('\n')),
    );
    expect(yaml.states.map((state) => [state.name, state.position?.line])).toEqual([
      ['Hold', 3],
      ['Done', 7],
    ]);
  });
});

describe('what keeps a definition from being read as written', () => {
  it('says a document with no StartAt or States is not a state machine', () => {
    const machine = machineOf({ Comment: 'a policy document' });
    expect(machine.states).toEqual([]);
    expect(machine.problems.map((problem) => problem.kind)).toEqual(['not-a-state-machine']);
  });

  it('names a transition to a state that is not beside it, and keeps the transition', () => {
    const machine = machineOf({
      StartAt: 'Missing',
      States: {
        A: { Type: 'Pass', Next: 'Nowhere' },
        B: { Type: 'Parallel', Branches: [{ StartAt: 'C', States: { C: { Type: 'Pass', Next: 'A' } } }], End: true },
      },
    });
    expect(machine.problems.map((problem) => [problem.kind, problem.state])).toEqual([
      ['unknown-state', undefined],
      ['unknown-state', 'A'],
      ['unknown-state', 'C'],
    ]);
    expect(machine.states.find((state) => state.name === 'A')?.transitions[0]?.to).toBe('Nowhere');
  });

  it('names a state used twice and a type the language does not have', () => {
    const machine = machineOf({
      StartAt: 'A',
      States: {
        A: { Type: 'Parallel', Branches: [{ StartAt: 'A', States: { A: { Type: 'Pass', End: true } } }], End: true },
        B: { Type: 'Loop', End: true },
      },
    });
    expect(machine.problems.map((problem) => [problem.kind, problem.state])).toEqual([
      ['duplicate-state', 'A'],
      ['unknown-state-type', 'B'],
    ]);
    expect(machine.states.map((state) => state.name)).toEqual(['A', 'B']);
  });
});
