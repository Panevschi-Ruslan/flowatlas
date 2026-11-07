import { exportKey } from '@flowatlas/core';
import { Built, CdkRef, Imported, ObjectValue, textOf, Unread, type Site, type Value } from './values.js';

/**
 * What the CDK's own static members and helpers stand for, where a reading of
 * the deployment has a use for it (P57).
 *
 * `lambda.Runtime.NODEJS_20_X` is the runtime `nodejs20.x`; `Schedule.cron({
 * hour: '2' })` is the expression `cron(0 2 * * ? *)`, as the CDK writes it
 * into the template; `s3.EventType.OBJECT_CREATED` is `s3:ObjectCreated:*`.
 * These are the CDK's rules restated, one row each, so a value the CDK would
 * write is the value the reading sees. A token the deployment fills in when it
 * runs - an account, a region, an import - is unread.
 */

/** `NODEJS_20_X` is `nodejs20.x`, `PYTHON_3_12` is `python3.12`, `PROVIDED_AL2023` is `provided.al2023`. */
export const runtimeOf = (member: string): string => {
  const node = /^NODEJS_(\d+)_X$/.exec(member);
  if (node !== null) return `nodejs${node[1]}.x`;
  if (member === 'NODEJS_LATEST') return 'nodejs';
  const python = /^PYTHON_(\d+)_(\d+)$/.exec(member);
  if (python !== null) return `python${python[1]}.${python[2]}`;
  const [family, ...rest] = member.toLowerCase().split('_');
  return rest.length === 0 ? (family as string) : `${family}${rest.join('.')}`;
};

/** The events a bucket's notification names, as the CDK's `EventType` spells them and S3 does. */
const S3_EVENTS: Readonly<Record<string, string>> = {
  OBJECT_CREATED: 's3:ObjectCreated:*',
  OBJECT_CREATED_PUT: 's3:ObjectCreated:Put',
  OBJECT_CREATED_POST: 's3:ObjectCreated:Post',
  OBJECT_CREATED_COPY: 's3:ObjectCreated:Copy',
  OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD: 's3:ObjectCreated:CompleteMultipartUpload',
  OBJECT_REMOVED: 's3:ObjectRemoved:*',
  OBJECT_REMOVED_DELETE: 's3:ObjectRemoved:Delete',
  OBJECT_REMOVED_DELETE_MARKER_CREATED: 's3:ObjectRemoved:DeleteMarkerCreated',
  OBJECT_RESTORE_POST: 's3:ObjectRestore:Post',
  OBJECT_RESTORE_COMPLETED: 's3:ObjectRestore:Completed',
};

/** Members of the root that are tokens: what the deployment fills in when it runs. */
const TOKENS = new Set(['core.Aws', 'core.Fn', 'core.Lazy', 'core.Token', 'core.SecretValue']);

/**
 * A static member followed to its end: an enum's member is the text it stands
 * for, a token is unread, anything else stays a reference for a call to use.
 */
export const staticValue = (ref: CdkRef): Value => {
  const owner = [ref.module, ...ref.path.slice(0, 1)].join('.');
  if (TOKENS.has(owner) && ref.path.length >= 2) return new Unread(`${ref.path.join('.')} is filled in when the stack is deployed`, 'token');
  const last = ref.path[ref.path.length - 1];
  if (ref.path.length < 2 || last === undefined || !/^[A-Z][A-Z0-9_]*$/.test(last)) return ref;
  const of = ref.path[ref.path.length - 2];
  if (of === 'Runtime') return runtimeOf(last);
  if (of === 'EventType' && ref.module === 'aws-s3') return S3_EVENTS[last] ?? last;
  return last;
};

/** A duration, as the CDK's `Duration` holds one. */
export interface Duration {
  readonly amount: number;
  readonly unit: 'second' | 'minute' | 'hour' | 'day';
}

const durationOf = (value: Value): Duration | undefined => {
  if (!(value instanceof Built) || !value.what.startsWith('core.Duration.')) return undefined;
  const unit = value.what.slice('core.Duration.'.length).replace(/s$/, '') as Duration['unit'];
  const amount = value.args[0];
  return typeof amount === 'number' && ['second', 'minute', 'hour', 'day'].includes(unit) ? { amount, unit } : undefined;
};

/** `rate(5 minutes)`, `rate(1 hour)`, as the CDK writes a rate. */
const rateOf = (value: Value): Value => {
  const duration = durationOf(value);
  if (duration === undefined) return new Unread('the rate is not a duration the files settle', 'not-a-duration');
  return `rate(${duration.amount} ${duration.unit}${duration.amount === 1 ? '' : 's'})`;
};

/** `cron(minute hour day month weekDay year)`, with the defaults the CDK fills in. */
const cronOf = (value: Value, withYear: boolean): Value => {
  if (!(value instanceof ObjectValue)) return new Unread('the cron options are not written out', 'not-an-object');
  const field = (name: string, fallback: string): string | Unread => {
    const written = value.get(name);
    if (written === undefined) return fallback;
    return textOf(written) ?? new Unread(`the cron ${name} is not read`, 'not-text');
  };
  const weekDay = value.get('weekDay');
  const day = value.get('day');
  const parts = [
    field('minute', '*'),
    field('hour', '*'),
    weekDay === undefined ? field('day', '*') : day === undefined ? '?' : field('day', '*'),
    field('month', '*'),
    weekDay === undefined ? '?' : field('weekDay', '?'),
    ...(withYear ? [field('year', '*')] : []),
  ];
  const unread = parts.find((part): part is Unread => part instanceof Unread);
  return unread ?? `cron(${parts.join(' ')})`;
};

type StaticCall = (args: readonly Value[], site: Site) => Value;

const expression: StaticCall = (args) => (typeof args[0] === 'string' ? args[0] : new Unread('the schedule expression is not text', 'not-text'));

/**
 * Static calls whose result the reading needs as a value, by what is called.
 * Every other static call is kept as a {@link Built} of what it was handed.
 */
const STATIC_CALLS: ReadonlyMap<string, StaticCall> = new Map<string, StaticCall>([
  ['aws-events.Schedule.rate', (args) => rateOf(args[0])],
  ['aws-events.Schedule.cron', (args) => cronOf(args[0], true)],
  ['aws-events.Schedule.expression', expression],
  ['aws-scheduler.ScheduleExpression.rate', (args) => rateOf(args[0])],
  ['aws-scheduler.ScheduleExpression.cron', (args) => cronOf(args[0], true)],
  ['aws-scheduler.ScheduleExpression.expression', expression],
  ['aws-applicationautoscaling.Schedule.expression', expression],
  // An output another stack exports, read back by its name (P249).
  ['core.Fn.importValue', (args) => (typeof args[0] === 'string' ? new Imported(exportKey(args[0]), args[0]) : new Unread('the value is imported from another stack under a name that is not read', 'imported'))],
  ['core.Stack.of', () => new Unread('the stack is read through what it creates, not as a value', 'stack')],
  ['aws-ssm.StringParameter.valueForStringParameter', () => new Unread('the value is read from a parameter in the account', 'parameter')],
  ['aws-ssm.StringParameter.valueFromLookup', () => new Unread('the value is looked up in the account', 'parameter')],
  ['aws-ssm.StringParameter.fromStringParameterName', () => new Unread('the value is read from a parameter in the account', 'parameter')],
]);

/** A static call: what it stands for, or what built it. */
export const staticCall = (ref: CdkRef, args: readonly Value[], site: Site): Value => {
  const call = STATIC_CALLS.get(ref.key);
  if (call !== undefined) return call(args, site);
  if (TOKENS.has([ref.module, ...ref.path.slice(0, 1)].join('.'))) return new Unread(`${ref.path.join('.')} is filled in when the stack is deployed`, 'token');
  return new Built(ref.key, args, site);
};
