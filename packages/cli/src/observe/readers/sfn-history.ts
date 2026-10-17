import { deployedArn } from '@flowatlas/aws';
import { only, SFN_HISTORY_READS } from '../allow-list.js';
import { executionIn, readAwsSpan, workflowName } from '../aws.js';
import type { ObservedSpan, SpanKind } from '../span.js';
import {
  Dropped,
  isObject,
  isoOfMs,
  list,
  ms2,
  NameNeeded,
  operationName,
  Skips,
  text,
  withFields,
  type Json,
  type TraceReader,
} from './shared.js';

/**
 * One Step Functions execution as `aws stepfunctions get-execution-history`
 * prints it, `{ events: [{ id, previousEventId, type, timestamp, ... }] }`
 * (P108): the run, each step it entered, and the function each step invoked.
 *
 * The workflow is named by `stateMachineArn` or `executionArn` when the user
 * merged `describe-execution`'s output into the file, by the version or alias
 * ARN an `ExecutionStarted` event carries, else by `--workflow`; with none,
 * the file is refused (D2), never counted on a name the file does not say.
 *
 * Every event's details hold the step's input and output, the task's
 * parameters, the role and the failure's text: none of them is read. A step
 * is said by its name, a failure by the event's type, a call by its
 * resource cut to the function or the operation it names.
 */

const STATE_ENTERED = /StateEntered$/;
const STATE_EXITED = /StateExited$/;

/** How an execution ends, and whether that is a failure. */
const EXECUTION_ENDS: Readonly<Record<string, boolean>> = {
  ExecutionSucceeded: false,
  ExecutionFailed: true,
  ExecutionTimedOut: true,
  ExecutionAborted: true,
};

/** How a call a step scheduled ends, and whether that is a failure. */
const CALL_ENDS: Readonly<Record<string, boolean>> = {
  LambdaFunctionSucceeded: false,
  LambdaFunctionFailed: true,
  LambdaFunctionTimedOut: true,
  LambdaFunctionStartFailed: true,
  LambdaFunctionScheduleFailed: true,
  TaskSucceeded: false,
  TaskFailed: true,
  TaskTimedOut: true,
  TaskStartFailed: true,
  TaskSubmitFailed: true,
  ActivitySucceeded: false,
  ActivityFailed: true,
  ActivityTimedOut: true,
  ActivityScheduleFailed: true,
};

/** Events that fail the step they happen in. */
const FAILURES: ReadonlySet<string> = new Set([
  ...Object.entries(CALL_ENDS).flatMap(([type, failed]) => (failed ? [type] : [])),
  ...Object.entries(EXECUTION_ENDS).flatMap(([type, failed]) => (failed ? [type] : [])),
]);

/** A service integration's `resourceType` as the SDK names the service (`aws-sdk:` integrations by their service). */
const TASK_SERVICES: Readonly<Record<string, string>> = {
  lambda: 'Lambda',
  dynamodb: 'DynamoDB',
  sqs: 'SQS',
  sns: 'SNS',
  events: 'EventBridge',
  eventbridge: 'EventBridge',
  states: 'SFN',
  sfn: 'SFN',
  s3: 'S3',
  kinesis: 'Kinesis',
};

interface HistoryEvent {
  id: number;
  previous: number;
  type: string;
  ms: number | undefined;
  details: (key: string, fields: readonly string[]) => Json;
}

/** A history's time: ISO text as the CLI prints it, or seconds since the epoch as the API returns them. */
const msOfTime = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e11 ? value * 1000 : value;
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : undefined;
};

const idOf = (value: unknown): number | undefined => {
  const id = typeof value === 'string' ? Number(value) : value;
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : undefined;
};

const isEvent = (value: unknown): boolean =>
  isObject(value) && typeof value['type'] === 'string' && idOf(value['id']) !== undefined && 'timestamp' in value;

const isHistory = (document: unknown): document is Json =>
  isObject(document) &&
  Array.isArray(document['events']) &&
  document['events'].length > 0 &&
  document['events'].every(isEvent) &&
  document['events'].some((event) => /^Execution|State(Entered|Exited)$/.test((event as Json)['type'] as string));

const eventsOf = (history: Json, skips: Skips, dropped: Dropped): HistoryEvent[] =>
  list(history['events'])
    .flatMap((raw): HistoryEvent[] => {
      dropped.outside(raw, SFN_HISTORY_READS.event);
      const event = only(raw, SFN_HISTORY_READS.event);
      const id = idOf(event['id']);
      const type = text(event['type']);
      if (id === undefined || type === undefined) {
        skips.add('event', 'without an id and a type');
        return [];
      }
      const details = (key: string, fields: readonly string[]): Json => {
        dropped.outside(event[key], fields);
        return only(event[key], fields);
      };
      return [{ id, previous: idOf(event['previousEventId']) ?? id - 1, type, ms: msOfTime(event['timestamp']), details }];
    })
    .sort((a, b) => a.id - b.id);

/** The workflow a history is of, from the file before the flag. */
const workflowOf = (history: Json, events: readonly HistoryEvent[], flag: string | undefined): string | undefined => {
  const started = events.find((event) => event.type === 'ExecutionStarted');
  const details = started?.details('executionStartedEventDetails', SFN_HISTORY_READS.executionStarted) ?? {};
  return (
    workflowName(text(history['stateMachineArn'])) ??
    workflowName(text(history['executionArn'])) ??
    workflowName(text(details['stateMachineVersionArn'])) ??
    workflowName(text(details['stateMachineAliasArn'])) ??
    flag
  );
};

/** A span still open: where it started, and whether something in it failed. */
interface Open {
  span: ObservedSpan;
  start: number | undefined;
  /** A step's name, to pair its exit with. */
  name?: string;
  enteredAfter?: number;
}

export const sfnHistoryReader: TraceReader = {
  name: 'sfn-history',
  takes: ['workflow'],
  sniff: isHistory,
  read: (document, fallbackService, options = {}) => {
    const skips = new Skips();
    const dropped = new Dropped();
    const history = document as Json;
    dropped.outside(history, SFN_HISTORY_READS.execution);
    const said = only(history, SFN_HISTORY_READS.execution);
    const events = eventsOf(said, skips, dropped);
    const machine = workflowOf(said, events, options.workflow);
    if (machine === undefined) {
      throw new NameNeeded("names no state machine (merge describe-execution's stateMachineArn into it)", '--workflow');
    }
    const service = fallbackService ?? machine;
    const resource = new Map([['cloud.resource_id', deployedArn('workflow', machine)]]);
    const started = events.find((event) => event.type === 'ExecutionStarted');
    // The execution's own name, never its ARN (an account and a region are in it): the samples' trace id.
    const traceId =
      text(said['name']) ?? executionIn(text(said['executionArn']))?.name ?? `${machine}@${isoOfMs(started?.ms) ?? 'unknown'}`;
    const make = (spanId: string, kind: SpanKind, fields: Partial<ObservedSpan>): ObservedSpan =>
      withFields({ traceId, spanId, kind }, { service, ...fields });

    const execution: Open = {
      span: make(String(started?.id ?? 0), 'server', { ...readAwsSpan({ text: resource, lists: new Map() }), at: isoOfMs(started?.ms) }),
      start: started?.ms,
    };
    const spans: ObservedSpan[] = [execution.span];
    const close = (open: Open, ms: number | undefined, failed: boolean): void => {
      if (open.start !== undefined && ms !== undefined && ms >= open.start) open.span.durationMs = ms2(ms - open.start);
      if (failed) open.span.error = true;
    };
    const states = new Map<number, Open>();
    const calls = new Map<number, Open>();
    /** The step open at each event, by the chain of previous events: a closed step hands back to the one around it. */
    const stepAt = new Map<number, number | undefined>();
    /** The call scheduled and not yet ended at each event. */
    const callAt = new Map<number, number | undefined>();
    /** Steps entered and not exited, by name: what an exit pairs with when the chain does not say. */
    const openByName = new Map<string, number[]>();
    const parentOf = (step: number | undefined): string => (step === undefined ? execution.span.spanId : states.get(step)!.span.spanId);

    for (const event of events) {
      const step = stepAt.get(event.previous);
      const call = callAt.get(event.previous);
      stepAt.set(event.id, step);
      callAt.set(event.id, STATE_ENTERED.test(event.type) || STATE_EXITED.test(event.type) ? undefined : call);
      if (STATE_ENTERED.test(event.type)) {
        const name = text(event.details('stateEnteredEventDetails', SFN_HISTORY_READS.stateEntered)['name']);
        const own = new Map([...resource, ...(name === undefined ? [] : [['aws.step_functions.state.name', name] as [string, string]])]);
        const span = make(String(event.id), 'internal', {
          parentId: parentOf(step),
          ...readAwsSpan({ text: own, lists: new Map() }),
          at: isoOfMs(event.ms),
        });
        spans.push(span);
        states.set(event.id, { span, start: event.ms, ...(name === undefined ? {} : { name }), enteredAfter: event.previous });
        if (name !== undefined) openByName.set(name, [...(openByName.get(name) ?? []), event.id]);
        stepAt.set(event.id, event.id);
      } else if (STATE_EXITED.test(event.type)) {
        const name = text(event.details('stateExitedEventDetails', SFN_HISTORY_READS.stateExited)['name']);
        const waiting = name === undefined ? [] : (openByName.get(name) ?? []);
        const entered = step !== undefined && states.get(step)?.name === name ? step : waiting.at(-1);
        if (entered !== undefined) {
          const open = states.get(entered)!;
          close(open, event.ms, false);
          if (name !== undefined) openByName.set(name, waiting.filter((id) => id !== entered));
          stepAt.set(event.id, stepAt.get(open.enteredAfter!));
        }
      }
      const scheduled =
        event.type === 'LambdaFunctionScheduled'
          ? event.details('lambdaFunctionScheduledEventDetails', SFN_HISTORY_READS.lambdaScheduled)
          : event.type === 'TaskScheduled'
            ? event.details('taskScheduledEventDetails', SFN_HISTORY_READS.taskScheduled)
            : undefined;
      if (scheduled !== undefined) {
        const fields = event.type === 'LambdaFunctionScheduled' ? lambdaCall(scheduled, resource) : taskCall(scheduled);
        const span = make(String(event.id), 'client', { parentId: parentOf(step), ...fields, at: isoOfMs(event.ms) });
        spans.push(span);
        calls.set(event.id, { span, start: event.ms });
        callAt.set(event.id, event.id);
      }
      const ended = CALL_ENDS[event.type];
      if (ended !== undefined && call !== undefined) {
        close(calls.get(call)!, event.ms, ended);
        callAt.set(event.id, undefined);
      }
      if (FAILURES.has(event.type) && step !== undefined) states.get(step)!.span.error = true;
      const finished = EXECUTION_ENDS[event.type];
      if (finished !== undefined) close(execution, event.ms, finished);
    }
    return { spans, skipped: skips.list(), droppedAttributes: dropped.count };
  },
};

/** A step's direct invoke of a function, named by the function's ARN. */
const lambdaCall = (details: Json, resource: ReadonlyMap<string, string>): Partial<ObservedSpan> => {
  const own = new Map([
    ...resource,
    ['rpc.system', 'aws-api'],
    ['rpc.service', 'Lambda'],
    ['rpc.method', 'Invoke'],
    ...(text(details['resource']) === undefined ? [] : [['aws.lambda.function.name', text(details['resource'])!] as [string, string]]),
  ]);
  return { rpc: 'Lambda/Invoke', ...readAwsSpan({ text: own, lists: new Map() }) };
};

/**
 * A service integration: the service and the operation only. What it was
 * called with is in `parameters`, which is never read, so the call names no
 * table, queue or function, and is credited to none (I3).
 */
const taskCall = (details: Json): Partial<ObservedSpan> => {
  const type = text(details['resourceType'])?.replace(/^aws-sdk:/, '');
  const operation = text(details['resource']) === undefined ? undefined : operationName(text(details['resource'])!);
  if (type === undefined || operation === undefined) return {};
  const service = TASK_SERVICES[type.toLowerCase()] ?? type;
  return { rpc: `${service}/${operation}`, awsOp: operation };
};
