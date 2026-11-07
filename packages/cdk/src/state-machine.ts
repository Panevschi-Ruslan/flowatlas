import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { DefinitionPosition, DeployedDefinition } from '@flowatlas/core';
import { branchesOf, isState, startOf, stateType } from './chains.js';
import { Built, Construct, ObjectValue, textOf, toJson, type Value } from './values.js';

/**
 * A CDK state machine's definition, written out as the Amazon States Language
 * the CDK synthesises (P57, D7).
 *
 * A chain of states is code; the reader of definitions reads the language. So
 * the chain is walked from the state it starts at, and each state written as
 * the CDK would write it: a `LambdaInvoke` is a task on
 * `arn:aws:states:::lambda:invoke` with the function in its `FunctionName`, a
 * `Choice` its choices and default, a `Parallel` its branches, a `Map` its
 * processor. A function, a queue, a topic or a machine a task is handed is a
 * `${…}` placeholder that the workflow's `fill` answers with its ARN, as a
 * Terraform template's is; every state is placed at the line its construct is
 * made on.
 */

/** What a task of each kind is run as, and the parameter that names what it runs on. */
interface TaskShape {
  readonly resource: (state: Construct) => string;
  readonly parameters: (state: Construct, ref: (value: Value) => string) => Record<string, unknown>;
}

const prop = (state: Construct, name: string): Value => state.props?.get(name);

/** `RUN_JOB` waits for what the call starts, `WAIT_FOR_TASK_TOKEN` for a token. */
const patternSuffix = (state: Construct): string => {
  const pattern = textOf(prop(state, 'integrationPattern'));
  return pattern === 'RUN_JOB' ? '.sync' : pattern === 'WAIT_FOR_TASK_TOKEN' ? '.waitForTaskToken' : '';
};

const plain = (value: Value): unknown => toJson(value) ?? {};

const TASKS: ReadonlyMap<string, TaskShape> = new Map<string, TaskShape>([
  [
    'LambdaInvoke',
    {
      resource: (state) => `arn:aws:states:::lambda:invoke${patternSuffix(state)}`,
      parameters: (state, ref) => ({ FunctionName: ref(prop(state, 'lambdaFunction')), 'Payload.$': '$' }),
    },
  ],
  [
    'SqsSendMessage',
    {
      resource: (state) => `arn:aws:states:::sqs:sendMessage${patternSuffix(state)}`,
      parameters: (state, ref) => ({ QueueUrl: ref(prop(state, 'queue')), 'MessageBody.$': '$' }),
    },
  ],
  [
    'SnsPublish',
    {
      resource: (state) => `arn:aws:states:::sns:publish${patternSuffix(state)}`,
      parameters: (state, ref) => ({ TopicArn: ref(prop(state, 'topic')), 'Message.$': '$' }),
    },
  ],
  [
    'EventBridgePutEvents',
    {
      resource: (state) => `arn:aws:states:::events:putEvents${patternSuffix(state)}`,
      parameters: (state, ref) => {
        const entries = prop(state, 'entries');
        return {
          Entries: (Array.isArray(entries) ? entries : []).map((entry) => {
            const bus = entry instanceof ObjectValue ? entry.get('eventBus') : undefined;
            return {
              ...(bus === undefined ? {} : { EventBusName: ref(bus) }),
              ...(entry instanceof ObjectValue && textOf(entry.get('source')) !== undefined ? { Source: textOf(entry.get('source')) } : {}),
              ...(entry instanceof ObjectValue && textOf(entry.get('detailType')) !== undefined ? { DetailType: textOf(entry.get('detailType')) } : {}),
              'Detail.$': '$',
            };
          }),
        };
      },
    },
  ],
  [
    'StepFunctionsStartExecution',
    {
      resource: (state) => `arn:aws:states:::states:startExecution${patternSuffix(state)}`,
      parameters: (state, ref) => ({ StateMachineArn: ref(prop(state, 'stateMachine')), 'Input.$': '$' }),
    },
  ],
  ...(['PutItem', 'UpdateItem', 'DeleteItem', 'GetItem'] as const).map(
    (action) =>
      [
        `Dynamo${action}`,
        {
          resource: () => `arn:aws:states:::dynamodb:${action.charAt(0).toLowerCase()}${action.slice(1)}`,
          parameters: (state: Construct, ref: (value: Value) => string) => ({ TableName: ref(prop(state, 'table')) }),
        },
      ] as const,
  ),
  [
    'CallAwsService',
    {
      resource: (state) => `arn:aws:states:::aws-sdk:${textOf(prop(state, 'service')) ?? 'unknown'}:${textOf(prop(state, 'action')) ?? 'unknown'}`,
      parameters: (state) => plain(prop(state, 'parameters')) as Record<string, unknown>,
    },
  ],
]);

/** A condition of a choice, written as the language writes one: `stringEquals` is `StringEquals`. */
const conditionOf = (condition: Value): Record<string, unknown> => {
  if (!(condition instanceof Built) || !condition.what.startsWith('aws-stepfunctions.Condition.')) return { Variable: '$', IsPresent: true };
  const method = condition.what.slice('aws-stepfunctions.Condition.'.length);
  const operator = (method.charAt(0).toUpperCase() + method.slice(1)).replace(/^Number/, 'Numeric');
  const [variable, operand] = condition.args;
  return { Variable: textOf(variable) ?? '$', [operator]: toJson(operand) ?? true };
};

/** Each state of a chain, written out from where it starts. */
class Writer {
  readonly lines = new Map<string, DefinitionPosition>();

  constructor(readonly ref: (value: Value) => string) {}

  nameOf(state: Construct): string {
    return textOf(prop(state, 'stateName')) ?? state.id;
  }

  /** `{ StartAt, States }` for the states reached from `start`. */
  machine(start: Construct): Record<string, unknown> {
    const states: Record<string, unknown> = {};
    const queue: Construct[] = [start];
    const seen = new Set<Construct>();
    while (queue.length > 0) {
      const state = queue.shift() as Construct;
      if (seen.has(state)) continue;
      seen.add(state);
      const name = this.nameOf(state);
      this.lines.set(name, { line: state.site.line, column: 1 });
      states[name] = this.state(state, (next) => {
        if (!seen.has(next)) queue.push(next);
      });
    }
    return { StartAt: this.nameOf(start), States: states };
  }

  state(state: Construct, reach: (next: Construct) => void): Record<string, unknown> {
    const type = stateType(state);
    const next = state.fields.get('next');
    const flow = (): Record<string, unknown> => {
      if (next instanceof Construct) {
        reach(next);
        return { Next: this.nameOf(next) };
      }
      return { End: true };
    };
    const catches = state.addedBy('addCatch').flatMap(({ args }) => {
      const handler = startOf(args[0]);
      if (handler === undefined) return [];
      reach(handler);
      const errors = args[1] instanceof ObjectValue ? toJson(args[1].get('errors')) : undefined;
      return [{ ErrorEquals: Array.isArray(errors) ? errors : ['States.ALL'], Next: this.nameOf(handler) }];
    });
    const withCatch = catches.length === 0 ? {} : { Catch: catches };
    switch (type) {
      case 'Succeed':
        return { Type: 'Succeed' };
      case 'Fail':
        return { Type: 'Fail', ...(textOf(prop(state, 'error')) === undefined ? {} : { Error: textOf(prop(state, 'error')) }) };
      case 'Pass':
        return { Type: 'Pass', ...flow() };
      case 'Wait':
        return { Type: 'Wait', Seconds: 0, ...flow() };
      case 'Choice': {
        const whens = state.addedBy('when').flatMap(({ args }) => {
          const target = startOf(args[1]);
          if (target === undefined) return [];
          reach(target);
          return [{ ...conditionOf(args[0]), Next: this.nameOf(target) }];
        });
        const otherwise = startOf(state.fields.get('otherwise'));
        if (otherwise !== undefined) reach(otherwise);
        return { Type: 'Choice', Choices: whens, ...(otherwise === undefined ? {} : { Default: this.nameOf(otherwise) }) };
      }
      case 'Parallel': {
        const branches = state.addedBy('branch').flatMap(({ args }) => args.map(startOf).filter((start): start is Construct => start !== undefined));
        return { Type: 'Parallel', Branches: branches.map((branch) => this.machine(branch)), ...withCatch, ...flow() };
      }
      case 'Map':
      case 'DistributedMap': {
        const processor = [...state.addedBy('itemProcessor'), ...state.addedBy('iterator')].map(({ args }) => startOf(args[0])).find((start) => start !== undefined);
        return {
          Type: 'Map',
          ...(textOf(prop(state, 'itemsPath')) === undefined ? {} : { ItemsPath: textOf(prop(state, 'itemsPath')) }),
          ...(processor === undefined ? {} : { ItemProcessor: { ProcessorConfig: { Mode: 'INLINE' }, ...this.machine(processor) } }),
          ...withCatch,
          ...flow(),
        };
      }
      default: {
        const shape = TASKS.get(type);
        return {
          Type: 'Task',
          Resource: shape?.resource(state) ?? `arn:aws:states:::${type}`,
          ...(shape === undefined ? {} : { Parameters: shape.parameters(state, this.ref) }),
          ...withCatch,
          ...flow(),
        };
      }
    }
  }
}

/** A state machine's definition, and what each placeholder in it stands for. */
export interface Written {
  readonly definition?: DeployedDefinition;
  /** Why the definition is not read, when it is not. */
  readonly unread?: string;
  /** What a placeholder stands for: a construct, an attribute, a value written out. */
  readonly placeholders: ReadonlyMap<string, Value>;
}

/** The definition of a `StateMachine` construct. */
export const definitionOf = (machine: Construct, repoDir: string, appDir: string): Written => {
  const placeholders = new Map<string, Value>();
  const ref = (value: Value): string => {
    const key = `ref${placeholders.size}`;
    placeholders.set(key, value);
    return `\${${key}}`;
  };
  const substitutions = machine.props?.get('definitionSubstitutions');
  if (substitutions instanceof ObjectValue) for (const [key, value] of substitutions.entries) placeholders.set(key, value);
  const body = machine.props?.get('definitionBody') ?? machine.props?.get('definition');
  const chained = (start: Construct | undefined): Written => {
    if (start === undefined) return { unread: 'the chain it is given starts at no state this reads', placeholders };
    const writer = new Writer(ref);
    const value = writer.machine(start);
    return {
      definition: {
        kind: 'value',
        file: machine.site.file,
        value,
        at: (path) => {
          // The innermost state the path is in: `["States", "Score", "Next"]`.
          for (let index = path.length - 2; index >= 0; index -= 1) {
            if (path[index] === 'States' && typeof path[index + 1] === 'string') {
              const line = writer.lines.get(path[index + 1] as string);
              if (line !== undefined) return line;
            }
          }
          return { line: machine.site.line, column: 1 };
        },
      },
      placeholders,
    };
  };
  if (isState(body) || (body instanceof Built && body.what !== 'aws-stepfunctions.DefinitionBody.fromFile' && body.what !== 'aws-stepfunctions.DefinitionBody.fromString' && body.what !== 'aws-stepfunctions.DefinitionBody.fromChainable')) {
    return chained(startOf(body));
  }
  if (!(body instanceof Built)) return { unread: 'it is given no definition this reads', placeholders };
  if (body.what === 'aws-stepfunctions.DefinitionBody.fromChainable') return chained(startOf(body.args[0]));
  if (body.what === 'aws-stepfunctions.DefinitionBody.fromFile') {
    const path = textOf(body.args[0]);
    if (path === undefined) return { unread: 'the file it is read from is not settled', placeholders };
    const absolute = path.startsWith('/') ? path : join(appDir, path);
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      return { unread: `${path} is not there`, placeholders };
    }
    const file = absolute.startsWith(repoDir) ? absolute.slice(repoDir.length + 1).split('\\').join('/') : path;
    return { definition: { kind: 'text', file, text, format: ['.yml', '.yaml'].includes(extname(absolute)) ? 'yaml' : 'json', firstLine: 1 }, placeholders };
  }
  // fromString: JSON text, or JSON.stringify of a value holding constructs.
  const [written] = body.args;
  if (typeof written === 'string') {
    try {
      const value = JSON.parse(written) as unknown;
      return { definition: { kind: 'value', file: machine.site.file, value, at: () => ({ line: machine.site.line, column: 1 }) }, placeholders };
    } catch {
      return { unread: 'the text it is given is not JSON', placeholders };
    }
  }
  if (written instanceof Built && written.what === 'json') {
    const replace = (value: Value): unknown => {
      if (value instanceof ObjectValue) return Object.fromEntries([...value.entries].map(([key, item]) => [key, replace(item)]));
      if (Array.isArray(value)) return value.map(replace);
      if (value === null || typeof value !== 'object') return value;
      return ref(value);
    };
    return { definition: { kind: 'value', file: machine.site.file, value: replace(written.args[0]), at: () => ({ line: machine.site.line, column: 1 }) }, placeholders };
  }
  return { unread: 'the text it is given is not settled', placeholders };
};

export { branchesOf };
