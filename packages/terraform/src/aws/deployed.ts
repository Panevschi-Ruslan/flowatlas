import { DEFAULT_EVENT_BUS, deployedNameIn } from '@flowatlas/aws';
import { alternativeAddress, generatedName, importedName, parameterKey, type DeployedImport, type DeployedKind, type DeliveryTarget, type Unresolved } from '@flowatlas/core';
import { describe, type Because, type Instance, type Value } from '../eval/values.js';
import { argument, HOLE, referencesOf, siteOf, textOf, textWithHoles, unreadRow, whyNot } from './arguments.js';
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
  /** `url` is a function's own address, by the function's deployed name (P54). */
  readonly kind: DeployedKind | 'url';
  readonly name: string;
  /** A function this deployment creates, by its position among `functions`. */
  readonly function?: number;
  /** The table's stream of changes rather than the table, for a table. */
  readonly changes?: boolean;
  /** The name is a stand-in for one the provider generates (P246). */
  readonly generated?: boolean;
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
  ['aws_s3_bucket', { kind: 'bucket', name: 'bucket' }],
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
  // A bucket's own name, which its `id` is too.
  'bucket',
]);

/**
 * Types whose name the provider generates when the block sets none: a queue, a
 * topic, a bucket. Such a thing is named by where it is declared, through
 * `generatedName` (P57, P246), so what this deployment points at it by - a
 * mapping, a subscription, a value handed to code - joins it, and nothing
 * outside the deployment can.
 */
const GENERATES_NAME = new Set(['aws_sqs_queue', 'aws_sns_topic', 'aws_s3_bucket']);

/** Whether a block declares something the provider will name, its own name argument unset or null. */
const namedByProvider = (target: Instance, name: string): boolean => {
  if (target.mode !== 'managed' || !GENERATES_NAME.has(target.type)) return false;
  const value = argument(target, name);
  // A `name_prefix` is the start of a name the provider still finishes.
  return value === undefined || value.kind === 'null';
};

/** The note a block whose name the provider generates gets, once, where it is declared. */
export const generatedNameRow = (instance: Instance): Unresolved | undefined => {
  const declared = DECLARED.get(instance.type);
  if (declared === undefined || !namedByProvider(instance, declared.name)) return undefined;
  return {
    ...siteOf(instance),
    symbol: instance.address,
    reason: 'deployed-name-generated',
    level: 'info',
    message: `${instance.address} is a ${declared.kind} with no name of its own, so it is named by where it is declared; what this deployment points at it by joins to it, and nothing outside it can`,
    hint: `Give it a ${declared.name} of its own where other repositories reach it.`,
  };
};

/** Types whose `function_name` names the function they stand in front of. */
const FUNCTION_ALIASES = new Set(['aws_lambda_alias']);

/** Types whose `function_url` is the address of the function they stand in front of. */
const FUNCTION_URLS = new Set(['aws_lambda_function_url']);

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
  // The value of a parameter of the account, which another deployment writes: its key (P253).
  if (target.mode === 'data' && target.type === 'aws_ssm_parameter' && (attribute === 'value' || attribute === 'insecure_value')) {
    const nameValue = argument(target, 'name');
    const name = textOf(nameValue);
    if (name === undefined) return whyNot(nameValue, `the name of ${target.address}`);
    return { reason: 'imported', text: `the value is the parameter ${name}, which another deployment writes`, imported: parameterKey(name) };
  }
  // A function URL's address is the function's own way in, named by the
  // function it stands in front of (P54).
  if (FUNCTION_URLS.has(target.type)) {
    const inner = attribute === 'function_url' ? argument(target, 'function_name') : undefined;
    const found = inner === undefined ? undefined : deployedOf(inner, reading, depth + 1);
    if (found !== undefined) return isBecause(found) ? found : { kind: 'url', name: found.name };
    const name = textOf(inner);
    return name === undefined ? undefined : { kind: 'url', name };
  }
  if (attribute !== undefined && !IDENTITY.has(attribute)) return undefined;
  if (FUNCTION_ALIASES.has(target.type)) {
    const inner = argument(target, 'function_name');
    return inner === undefined ? undefined : deployedOf(inner, reading, depth + 1);
  }
  const declared = DECLARED.get(target.type);
  if (declared === undefined) return undefined;
  const index = declared.kind === 'function' && target.mode === 'managed' ? reading.functionIndex(target) : undefined;
  if (namedByProvider(target, declared.name)) {
    return { kind: declared.kind, name: generatedName(target.address), generated: true, ...(attribute === 'stream_arn' ? { changes: true } : {}) };
  }
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

/** That the deployment reads a value another publishes, at a block: once per block and key (P253). */
export const importAt = (reading: { readonly imports: DeployedImport[] }, instance: Instance, key: string, what: string, kinds?: readonly DeployedKind[], alternatives?: DeployedImport['alternatives']): void => {
  const site = siteOf(instance);
  if (reading.imports.some((found) => found.key === key && found.file === site.file && found.line === site.line)) return;
  reading.imports.push({ key, ...site, what, ...(kinds === undefined ? {} : { kinds }), ...(alternatives === undefined ? {} : { alternatives }) });
};

/**
 * Something another deployment publishes, used where the use says only that
 * it is one of `kinds` (P253): one reading per kind, each under its own
 * address, of which the linker keeps the one the publisher's value is; one
 * kind is no choice, under the block's own address.
 */
export const alternativesAt = (
  reading: { readonly imports: DeployedImport[] },
  instance: Instance,
  key: string,
  kinds: readonly DeployedKind[],
  what: string,
  address = instance.address,
): { readonly kind: DeployedKind; readonly name: string; readonly address: string }[] => {
  const name = importedName(key);
  if (kinds.length === 1) {
    importAt(reading, instance, key, what, kinds);
    return kinds.map((kind) => ({ kind, name, address }));
  }
  const alternatives = kinds.map((kind) => ({ kind, address: alternativeAddress(address, kind) }));
  importAt(reading, instance, key, what, kinds, alternatives);
  return alternatives.map((alternative) => ({ ...alternative, name }));
};
