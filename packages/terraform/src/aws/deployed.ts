import { DEFAULT_EVENT_BUS, deployedNameIn } from '@flowatlas/aws';
import type { DeployedKind, DeliveryTarget } from '@flowatlas/core';
import { describe, type Because, type Instance, type Value } from '../eval/values.js';
import { argument, HOLE, referencesOf, textOf, textWithHoles, unreadRow, whyNot } from './arguments.js';
import type { ResourceReading } from './reading.js';

/**
 * What a reference, an ARN or a URL stands for: a function, a workflow, a
 * queue, a topic, a bus, a table or a stream, by the name it is deployed under.
 *
 * Everything a subscriber, a target or a value of the environment points at is
 * one of these, and the pointing is written in one of three ways: a reference
 * to the block that declares it (`aws_sqs_queue.returns.arn`), an ARN or URL
 * written out (`arn:aws:sqs:eu-west-1:111122223333:returns`), or a template
 * holding either. Each way is read here, once, for every reader.
 */

/** A deployed thing, by kind and deployed name. */
export interface Deployed {
  readonly kind: DeployedKind;
  readonly name: string;
  /** A function this deployment creates, by its position among `functions`. */
  readonly function?: number;
  /** The table's stream of changes rather than the table, for a table. */
  readonly changes?: boolean;
}

/**
 * Each resource type that declares, or looks up, something deployed: what it
 * is and which argument holds its name. A `data` block of the same type looks
 * the same thing up by the same argument, so one row serves both.
 */
const DECLARED: ReadonlyMap<string, { readonly kind: DeployedKind; readonly name: string }> = new Map([
  ['aws_lambda_function', { kind: 'function', name: 'function_name' }],
  ['aws_sfn_state_machine', { kind: 'workflow', name: 'name' }],
  ['aws_sqs_queue', { kind: 'queue', name: 'name' }],
  ['aws_sns_topic', { kind: 'topic', name: 'name' }],
  ['aws_cloudwatch_event_bus', { kind: 'bus', name: 'name' }],
  ['aws_dynamodb_table', { kind: 'table', name: 'name' }],
  ['aws_kinesis_stream', { kind: 'stream', name: 'name' }],
]);

/**
 * Attributes that identify the thing they belong to. Any other argument of a
 * queue - its delay, its retention - is a value of the queue and not the queue,
 * and is not read as naming it.
 */
const IDENTITY = new Set([
  'arn',
  'id',
  'url',
  'name',
  'function_name',
  'invoke_arn',
  'qualified_arn',
  'qualified_invoke_arn',
  'stream_arn',
]);

/** Types whose `function_name` names the function they stand in front of. */
const FUNCTION_ALIASES = new Set(['aws_lambda_alias']);

/**
 * What an ARN or URL written out names, if it is one, in the forms
 * `@flowatlas/aws` states for every reader. A region or an account the files
 * leave open does not matter to which thing it is; a hole in the name does, and
 * the text names nothing.
 */
export const deployedInText = (text: string): Deployed | undefined => {
  const found = deployedNameIn(text);
  return found === undefined || found.name.includes(HOLE) ? undefined : found;
};

const isBecause = (found: Deployed | Because): found is Because => 'reason' in found;

/**
 * What a value refers to, when it is an identifying attribute of a block that
 * declares something deployed; a `Because` when it is one and its name is not
 * read; `undefined` when it refers to nothing of the kind.
 */
export const deployedOf = (value: Value, reading: Pick<ResourceReading, 'functionIndex'>, depth = 0): Deployed | Because | undefined => {
  if (depth > 8) return undefined;
  const via = 'via' in value ? value.via : undefined;
  const target = value.kind === 'ref' ? value.target : value.kind === 'instance' ? value.instance : via?.target;
  if (target === undefined) return undefined;
  const attribute = value.kind === 'ref' ? String(value.attribute[0]) : value.kind === 'instance' ? undefined : via?.attribute;
  if (attribute !== undefined && !IDENTITY.has(attribute)) return undefined;
  if (FUNCTION_ALIASES.has(target.type)) {
    const inner = argument(target, 'function_name');
    return inner === undefined ? undefined : deployedOf(inner, reading, depth + 1);
  }
  const declared = DECLARED.get(target.type);
  if (declared === undefined) return undefined;
  const index = declared.kind === 'function' && target.mode === 'managed' ? reading.functionIndex(target) : undefined;
  const nameValue = argument(target, declared.name);
  const name = textOf(nameValue);
  if (name === undefined) return whyNot(nameValue, `the name of ${target.address}`);
  return {
    kind: declared.kind,
    name,
    ...(index === undefined ? {} : { function: index }),
    ...(attribute === 'stream_arn' ? { changes: true } : {}),
  };
};

/**
 * What one argument of a block points at, however it is written: a reference,
 * an ARN or URL written out, a template holding a reference, or a template
 * whose name part is written out. `undefined` when the argument is not set;
 * a `Because` when it is set and names nothing this reading can place.
 */
export const deployedAt = (
  instance: Instance,
  name: string,
  reading: Pick<ResourceReading, 'functionIndex'>,
): Deployed | Because | undefined => {
  const value = argument(instance, name);
  if (value === undefined) return undefined;
  return deployedOfValue(value, `${name} of ${instance.address}`, reading, () => [
    ...referencesOf(instance, name),
    textWithHoles(instance, name),
  ]);
};

/**
 * The same for a value already in hand - an entry of an object, a part of a
 * nested block - with whatever else the caller can offer to try after it.
 */
export const deployedOfValue = (
  value: Value,
  what: string,
  reading: Pick<ResourceReading, 'functionIndex'>,
  more: () => readonly (Value | string | undefined)[] = () => [],
): Deployed | Because => {
  const direct = deployedOf(value, reading);
  if (direct !== undefined) return direct;
  const text = textOf(value);
  if (text !== undefined) {
    return deployedInText(text) ?? { reason: 'unplaced', text: `${what} is ${JSON.stringify(text)}, which is not an ARN or URL of anything this reading follows` };
  }
  let named: Because | undefined;
  for (const candidate of more()) {
    if (candidate === undefined) continue;
    const found = typeof candidate === 'string' ? deployedInText(candidate) : deployedOf(candidate, reading);
    if (found === undefined) continue;
    if (!isBecause(found)) return found;
    named ??= found;
  }
  if (named !== undefined) return named;
  if (value.kind === 'ref' || value.kind === 'instance') {
    return { reason: 'unplaced', text: `${what} is ${describe(value)}, which is not something this reading follows` };
  }
  return whyNot(value, what);
};

/**
 * A bus as written - a name, an ARN, a reference to a bus declared or looked up
 * - or why it is not read; `default` where nothing names one.
 */
export const busOf = (value: Value | undefined, what: string, reading: Pick<ResourceReading, 'functionIndex'>): string | Because => {
  if (value === undefined || value.kind === 'null') return DEFAULT_EVENT_BUS;
  const text = textOf(value);
  if (text !== undefined) return deployedInText(text)?.name ?? text;
  const found = deployedOf(value, reading);
  if (found !== undefined) return isBecause(found) ? found : found.name;
  return whyNot(value, what);
};

/** A found thing as the target a delivery hands its messages to, when it can be one. */
export const asTarget = (found: Deployed): DeliveryTarget | undefined => {
  switch (found.kind) {
    case 'function':
      return found.function === undefined ? { kind: 'function', name: found.name } : { kind: 'function', function: found.function };
    case 'workflow':
      return { kind: 'workflow', name: found.name };
    case 'queue':
    case 'topic':
    case 'bus':
      return { kind: found.kind, name: found.name };
    default:
      return undefined;
  }
};

/**
 * What a target hands its messages to, or the row that says why not.
 *
 * A target of a kind nothing here follows - a container task, an API
 * destination, a log group - is an `info` row: it is read, and it is not a
 * function, a workflow or a channel. A target whose name is not read is a row a
 * person can act on.
 */
export const targetOf = (
  found: Deployed | Because | undefined,
  owner: Instance,
  what: string,
  reading: ResourceReading,
): DeliveryTarget | undefined => {
  if (found === undefined) {
    reading.rows.push(unreadRow(owner, 'subscription-target-unread', what, { reason: 'absent', text: 'nothing names it' }));
    return undefined;
  }
  if (isBecause(found)) {
    reading.rows.push(unreadRow(owner, 'subscription-target-unread', what, found, found.reason === 'unplaced' ? 'info' : undefined));
    return undefined;
  }
  const target = asTarget(found);
  if (target === undefined) {
    reading.rows.push(
      unreadRow(owner, 'subscription-target-unread', what, { reason: 'unplaced', text: `it is a ${found.kind} (${found.name}), which nothing is delivered to` }, 'info'),
    );
  }
  return target;
};

export { isBecause };
