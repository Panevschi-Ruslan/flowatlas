import { FUNCTION_TRANSIENT_ERRORS, RETRY_WILDCARDS } from '@flowatlas/aws';
import type { Unresolved } from '@flowatlas/core';
import type { State, StateMachine } from './definition.js';
import type { Task } from './tasks.js';

/**
 * What a task state's own settings leave unsaid that the service needs said
 * (P389), from the definition alone:
 *
 * - a task that waits on an activity, a `.sync` job or a task token, with no
 *   `TimeoutSeconds` of its own and none on its state machine, waits for ever
 *   for an answer that never comes (`workflow-task-untimed`); a request and
 *   response task has a timeout of the service's own and is not one;
 * - a task waiting on a task token with no `HeartbeatSeconds` notices a worker
 *   that died only at its timeout (`workflow-callback-no-heartbeat`);
 * - a task invoking a function that retries none of the platform's transient
 *   errors fails its execution on one of them (`workflow-lambda-unretried`);
 *   one that catches them, never retrying, is said at `info`, since the
 *   failure is handled, only not tried again.
 *
 * A field given by a path (`TimeoutSecondsPath`) or an expression counts as
 * given: when it is read is the service's business, not whether. Each row is
 * written out whole, its reason beside its file and line, for the gate that
 * holds every reason to the doctor catalogue (I13).
 */

/** Where the rows go: the definition's file, the state's line, and the node drawn for the state. */
export interface TaskSite {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  /** The workflow's name, for the message. */
  readonly workflow: string;
}

const hasField = (state: State, field: string): boolean =>
  state.fields[field] !== undefined || state.fields[`${field}Path`] !== undefined;

/** Whether a task waits on something outside the service to answer: an activity's worker, a job, a token. */
const waitsOn = (task: Task): string | undefined => {
  if (task.kind === 'activity') return 'an activity';
  switch (task.call?.pattern) {
    case 'sync':
    case 'sync:2':
      return `the ${task.call.service} job it starts (.sync)`;
    case 'wait-for-task-token':
      return 'a task token handed back (.waitForTaskToken)';
    default:
      return undefined;
  }
};

/** Whether a task invokes a function: the function's ARN as its resource, or the function integration. */
const invokesFunction = (task: Task): boolean => task.kind === 'function' && (task.call === undefined || task.call.service === 'lambda');

/** The error names a list of retriers or catchers names, as written. */
const errorsNamed = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const errors = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['ErrorEquals'] : undefined;
        return Array.isArray(errors) ? errors.filter((error): error is string => typeof error === 'string') : [];
      })
    : [];

const COVERING: ReadonlySet<string> = new Set([...FUNCTION_TRANSIENT_ERRORS, ...RETRY_WILDCARDS]);

const covers = (errors: readonly string[]): boolean => errors.some((error) => COVERING.has(error));

export const taskSettingRows = (machine: StateMachine, state: State, task: Task, site: TaskSite): Unresolved[] => {
  const rows: Unresolved[] = [];
  const { file, line, id, workflow } = site;
  const step = `${workflow}: ${state.name}`;
  const waits = waitsOn(task);
  if (waits !== undefined && !hasField(state, 'TimeoutSeconds') && machine.timeoutSeconds === undefined) {
    rows.push({
      file,
      line,
      reason: 'workflow-task-untimed',
      message: `${step} waits on ${waits} with no TimeoutSeconds, and the state machine has none: if the answer never comes, the execution waits until the service's own limit`,
      hint: 'Give the task a TimeoutSeconds, or the state machine one.',
      symbol: id,
      meta: { waitsOn: task.kind === 'activity' ? 'activity' : task.call?.pattern },
    });
  }
  if (task.call?.pattern === 'wait-for-task-token' && !hasField(state, 'HeartbeatSeconds')) {
    rows.push({
      file,
      line,
      reason: 'workflow-callback-no-heartbeat',
      level: 'info',
      message: `${step} waits for a task token with no HeartbeatSeconds, so a worker that died is noticed only when the task times out`,
      hint: 'Give the task a HeartbeatSeconds below its timeout, and have the worker send heartbeats.',
      symbol: id,
    });
  }
  if (invokesFunction(task) && Array.isArray(state.fields['Retry'] ?? []) && !covers(errorsNamed(state.fields['Retry']))) {
    const caught = covers(errorsNamed(state.fields['Catch']));
    rows.push({
      file,
      line,
      reason: 'workflow-lambda-unretried',
      level: caught ? 'info' : 'action',
      message: caught
        ? `${step} invokes a function and retries none of the platform's transient errors; a Catch takes them, so one ends the step on its error path rather than being tried again`
        : `${step} invokes a function and retries none of the platform's transient errors, so one fails the execution`,
      hint: `Add a Retry naming ${FUNCTION_TRANSIENT_ERRORS.slice(0, -1).join(', ')} and ${FUNCTION_TRANSIENT_ERRORS[FUNCTION_TRANSIENT_ERRORS.length - 1] ?? ''}.`,
      symbol: id,
      meta: { retries: errorsNamed(state.fields['Retry']), ...(caught ? { caught: true } : {}) },
    });
  }
  return rows;
};
