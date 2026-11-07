import { Built, Construct, type Site, type Value } from './values.js';

/**
 * A state machine's definition, as the CDK builds it: states are constructs,
 * and `.next()`, `Choice.when()`, `Parallel.branch()` and `Map.itemProcessor()`
 * join them into a chain (P57).
 *
 * The chain is kept on the states themselves - each state's next state, a
 * choice's branches - as the CDK keeps it, so that once the app has run the
 * definition can be written out from the state it starts at
 * (`state-machine.ts`). A chain is a start and the states it ends at, which is
 * what `.next()` joins onto.
 */

/** The modules whose constructs are states of a state machine. */
const STATE_MODULES = new Set(['aws-stepfunctions', 'aws-stepfunctions-tasks']);

/** Constructs of the step-functions module that are not states. */
const NOT_STATES = new Set(['aws-stepfunctions.StateMachine', 'aws-stepfunctions.Activity', 'aws-stepfunctions.StateMachineFragment']);

export const isState = (value: Value): value is Construct =>
  value instanceof Construct && STATE_MODULES.has(value.type.slice(0, value.type.indexOf('.'))) && !NOT_STATES.has(value.type);

const isChain = (value: Value): value is Built => value instanceof Built && (value.what === 'chain' || value.what === 'aws-stepfunctions.Chain.start' || value.what === 'aws-stepfunctions.Chain.sequence');

export const isChainable = (value: Value): boolean => isState(value) || isChain(value);

/** Where a chain or a state starts. */
export const startOf = (value: Value): Construct | undefined => {
  if (isState(value)) return value;
  if (!(value instanceof Built)) return undefined;
  if (value.what === 'chain') return value.state.get('start') as Construct | undefined;
  if (value.what === 'aws-stepfunctions.Chain.start' || value.what === 'aws-stepfunctions.Chain.sequence') return startOf(value.args[0]);
  return undefined;
};

/** A state's type, without its module: `Choice`, `LambdaInvoke`. */
export const stateType = (state: Construct): string => state.type.slice(state.type.indexOf('.') + 1);

const TERMINAL = new Set(['Succeed', 'Fail']);

/** The states a chain or a state ends at: what a `.next()` after it is joined onto. */
export const endsOf = (value: Value, depth = 0): Construct[] => {
  if (depth > 64) return [];
  if (value instanceof Built && value.what === 'chain') return (value.state.get('ends') as Construct[] | undefined) ?? [];
  if (value instanceof Built && (value.what === 'aws-stepfunctions.Chain.start' || value.what === 'aws-stepfunctions.Chain.sequence')) {
    const last = value.what === 'aws-stepfunctions.Chain.sequence' ? value.args[value.args.length - 1] : value.args[0];
    return endsOf(last, depth + 1);
  }
  if (!isState(value)) return [];
  if (TERMINAL.has(stateType(value))) return [];
  if (stateType(value) === 'Choice') return branchesOf(value).flatMap((branch) => endsOf(branch, depth + 1));
  const next = value.fields.get('next');
  return next === undefined ? [value] : endsOf(next, depth + 1);
};

/** Where a choice goes: each `when`, then its `otherwise`. */
export const branchesOf = (choice: Construct): Value[] => [
  ...choice.addedBy('when').map(({ args }) => args[1]),
  ...(choice.fields.has('otherwise') ? [choice.fields.get('otherwise')] : []),
];

const chain = (start: Construct | undefined, ends: readonly Construct[], site: Site): Built => {
  const made = new Built('chain', [], site);
  made.state.set('start', start);
  made.state.set('ends', [...ends]);
  return made;
};

/** One method of a state or a chain, as the CDK joins states with it. */
export const chainMethod = (receiver: Value, name: string, args: readonly Value[], site: Site): Value => {
  const [first] = args;
  switch (name) {
    case 'next': {
      const next = startOf(first);
      for (const end of endsOf(receiver)) if (next !== undefined) end.fields.set('next', next);
      return chain(startOf(receiver), endsOf(first), site);
    }
    case 'otherwise':
      if (receiver instanceof Construct) receiver.fields.set('otherwise', startOf(first));
      return receiver;
    case 'afterwards':
      return chain(startOf(receiver), endsOf(receiver), site);
    case 'when':
    case 'branch':
    case 'itemProcessor':
    case 'iterator':
    case 'addCatch':
    case 'addRetry':
      return receiver;
    case 'toSingleState':
      return receiver;
    default:
      return receiver;
  }
};
