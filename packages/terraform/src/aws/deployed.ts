import { DEFAULT_EVENT_BUS, deployedNameIn } from '@flowatlas/aws';
import { alternativeAddress, generatedName, importedName, parameterKey, type DeployedDelivery, type DeployedImport, type DeployedKind, type DeliveryTarget, type Unresolved } from '@flowatlas/core';
import { stateAddress } from '../configuration/load.js';
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
  /**
   * The name is written with values other deployments publish (P261), by
   * their keys, each one's stand-in in place: the whole name, one key and
   * no `within`; a name built of several, or of one and text, `within` it.
   */
  readonly embeds?: { readonly keys: readonly string[]; readonly within?: string };
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

/** The key an output of a state is read under: by the backend's identity and the output's name (P21, P261). */
export const stateOutputKey = (state: string, output: string): string => `state:${state}#${output}`;

/** One way a string template renders: its text, and the keys of the values other deployments publish written into it. */
interface Way {
  readonly text: string;
  readonly keys: readonly string[];
}

/** At most this many ways a template's undecided conditions can go are read; more is not read at all. */
const MAX_WAYS = 16;

/**
 * A string template as text, with each value another deployment publishes
 * written as its stand-in (`importedName`) and every other part not known a
 * {@link HOLE} (P261): once per way the `%{ if }`s the files do not decide
 * can go (P264); `undefined` where there are more ways than are read.
 */
const waysOf = (pieces: readonly (string | Value)[], reading: Pick<ResourceReading, 'functionIndex'>, depth: number): Way[] | undefined => {
  if (depth > 8) return undefined;
  let ways: Way[] = [{ text: '', keys: [] }];
  for (const piece of pieces) {
    let options: Way[] | undefined;
    if (typeof piece === 'string') options = [{ text: piece, keys: [] }];
    else if (piece.kind === 'unknown' && piece.ways !== undefined) {
      const each = piece.ways.map((way) => waysOf(way, reading, depth + 1));
      options = each.some((way) => way === undefined) ? undefined : (each as Way[][]).flat();
    } else if (piece.kind === 'unknown' && piece.template !== undefined) options = waysOf(piece.template, reading, depth + 1);
    else {
      const found = piece.kind === 'unknown' ? undefined : deployedOf(piece, reading, depth + 1);
      options = [found !== undefined && isBecause(found) && found.imported !== undefined ? { text: importedName(found.imported), keys: [found.imported] } : { text: HOLE, keys: [] }];
    }
    if (options === undefined) return undefined;
    ways = ways.flatMap((way) => (options as Way[]).map((option) => ({ text: way.text + option.text, keys: [...way.keys, ...option.keys] })));
    if (ways.length > MAX_WAYS) return undefined;
  }
  return ways;
};

/** Whether a template holds a piece a condition the files do not decide stands for. */
const isUndecided = (pieces: readonly (string | Value)[]): boolean =>
  pieces.some((piece) => typeof piece !== 'string' && piece.kind === 'unknown' && (piece.ways !== undefined || (piece.template !== undefined && isUndecided(piece.template))));

/**
 * What a string written around values other deployments publish names
 * (P261): an ARN or a URL whose name is one of them, by its stand-in; one
 * whose name is built of several, or of one and text, by that name with each
 * stand-in in place, which the linker writes once every part is joined. An
 * import outside the name - the account - does not change which thing it is.
 *
 * A template with `%{ if }`s the files do not decide is read every way they
 * can go, and names what every way names, with the imports of every way
 * written into the name; where the ways name different things, it names none
 * of them and says so (P264). A template of nothing but text and such
 * conditions is read the same way, though it holds no import.
 */
const builtOf = (value: Extract<Value, { kind: 'unknown' }>, reading: Pick<ResourceReading, 'functionIndex'>, depth: number): Deployed | Because | undefined => {
  const template = value.template ?? [];
  const undecided = isUndecided(template);
  const ways = waysOf(template, reading, depth);
  if (ways === undefined) return undecided ? { reason: 'undecided', text: `the conditions in it can go more than ${MAX_WAYS} ways, which are not read` } : undefined;
  const keys = [...new Set(ways.flatMap((way) => way.keys))];
  if (keys.length === 0 && !undecided) return undefined;
  const named = ways.map((way) => deployedNameIn(way.text));
  // A template of no import with a part not known is read as it always was, by what it refers to.
  if (named.some((found) => found === undefined || found.name.includes(HOLE))) return keys.length === 0 ? undefined : value.because;
  const [found] = named as NonNullable<(typeof named)[number]>[];
  if (found === undefined) return value.because;
  if (named.some((other) => other?.kind !== found.kind || other.name !== found.name)) {
    return { ...value.because, reason: 'undecided', text: `which ${found.kind} it names depends on a condition the files do not decide: ${value.because.text}` };
  }
  const inName = keys.filter((key) => found.name.includes(importedName(key)));
  const [only] = inName;
  const base: Deployed = { kind: found.kind, name: found.name, ...(found.changes === true ? { changes: true } : {}) };
  if (only === undefined) return base;
  return { ...base, embeds: inName.length === 1 && found.name === importedName(only) ? { keys: inName } : { keys: inName, within: found.name } };
};

/** That a name read at a block is written with values other deployments publish: each one's import, as the name or a part of it (P261). */
export const importsOfName = (reading: { readonly imports: DeployedImport[] }, instance: Instance, found: Deployed | Because | undefined, what: string): void => {
  if (found === undefined || isBecause(found) || found.embeds === undefined || found.kind === 'url') return;
  const site = siteOf(instance);
  const { keys, within } = found.embeds;
  for (const key of keys) {
    if (reading.imports.some((one) => one.key === key && one.file === site.file && one.line === site.line && one.within === within)) continue;
    reading.imports.push({ key, ...site, what, kinds: [found.kind], as: 'name', ...(within === undefined ? {} : { within }) });
  }
};

/**
 * What a value refers to, when it is an identifying attribute of a block that
 * declares something deployed; a `Because` when it is one and its name is not
 * read; `undefined` when it refers to nothing of the kind.
 */
export const deployedOf = (value: Value, reading: Pick<ResourceReading, 'functionIndex'>, depth = 0): Deployed | Because | undefined => {
  if (depth > 8) return undefined;
  // A string written around values other deployments publish (P261).
  if (value.kind === 'unknown' && value.template !== undefined) return builtOf(value, reading, depth);
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
  // An output of another configuration's state, which that configuration publishes (P261).
  if (target.mode === 'data' && target.type === 'terraform_remote_state' && value.kind === 'ref' && attribute === 'outputs') {
    const output = value.attribute[1];
    const settings = argument(target, 'config');
    const address = settings?.kind === 'object' ? stateAddress(textOf(argument(target, 'backend')) ?? 'local', settings.entries) : undefined;
    if (output === undefined || address === undefined) return { reason: 'state-unread', text: `the state ${target.address} reads is not one the files settle` };
    return { reason: 'imported', text: `the value is the output ${String(output)} of the state ${address}, which another configuration publishes`, imported: stateOutputKey(address, String(output)) };
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
  reading: Pick<ResourceReading, 'functionIndex' | 'imports'>,
): Deployed | Because | undefined => {
  const value = argument(instance, name);
  if (value === undefined) return undefined;
  const found = deployedOfValue(value, `${name} of ${instance.address}`, reading, () => [
    ...referencesOf(instance, name),
    textWithHoles(instance, name),
  ]);
  importsOfName(reading, instance, found, `${name} of ${instance.address}`);
  return found;
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
  importsOfName(reading, owner, found, what);
  const target = asTarget(found);
  if (target === undefined) {
    reading.rows.push(
      unreadRow(owner, 'subscription-target-unread', what, { reason: 'unplaced', text: `it is a ${found.kind} (${found.name}), which nothing is delivered to` }, 'info'),
    );
  }
  return target;
};

export { isBecause };

/**
 * A delivery from a block onto what a value names (P23). A value another
 * deployment writes to a parameter of the account is read as each kind of
 * thing the delivery can hand to - `kinds`, one where the use says which (a
 * subscription's protocol), more where it does not (a rule's target) - each
 * under an address of its own, of which the linker keeps the one the
 * publisher's value is (P253, P259). `shape` finishes a target as the
 * delivery hands to it.
 */
export const deliverAt = (
  reading: ResourceReading,
  owner: Instance,
  delivery: Omit<DeployedDelivery, 'to'>,
  found: Deployed | Because | undefined,
  kinds: readonly DeployedKind[],
  what: string,
  shape: (to: DeliveryTarget | undefined) => DeliveryTarget | undefined = (to) => to,
): void => {
  if (found !== undefined && isBecause(found) && found.imported !== undefined && kinds.length > 0) {
    for (const alternative of alternativesAt(reading, owner, found.imported, kinds, what, delivery.address)) {
      const to = shape(asTarget(alternative));
      reading.deliveries.push({ ...delivery, address: alternative.address, ...(to === undefined ? {} : { to }) });
    }
    return;
  }
  const to = shape(targetOf(found, owner, what, reading));
  reading.deliveries.push({ ...delivery, ...(to === undefined ? {} : { to }) });
};

/** What a rule's or a schedule's target may be, where the use does not say (P259): everything a delivery hands to. */
export const TARGET_KINDS: readonly DeployedKind[] = ['function', 'queue', 'topic', 'bus', 'workflow'];

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
