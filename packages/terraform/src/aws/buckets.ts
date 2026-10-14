import { DEFAULT_EVENT_BUS, S3_DETAIL_TYPES, S3_EVENT_SOURCE } from '@flowatlas/aws';
import { asText, type Because, type Instance, type Value } from '../eval/values.js';
import { argument, siteOf, textOf, unreadRow, whyNot } from './arguments.js';
import { deployedInText, deployedOf, deployedOfValue, isBecause, targetOf } from './deployed.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * A bucket's notifications: what each object written to it, or removed from
 * it, is handed to (P52).
 *
 * `aws_s3_bucket_notification` names the bucket once and then one block per
 * target - a function, a queue, a topic - each with the events it takes and,
 * when it filters, the start and end of the keys. Each block is a delivery from
 * the bucket's channel. `eventbridge = true` sends every event of the bucket to
 * the default bus besides, as source `aws.s3`, where the rules of that bus take
 * them as they take any event; it is read as a delivery onto the bus per family
 * of events a write fires.
 */

/** The block of each kind of target, and the argument that names it. */
const TARGET_BLOCKS: ReadonlyMap<string, string> = new Map([
  ['lambda_function', 'lambda_function_arn'],
  ['queue', 'queue_arn'],
  ['topic', 'topic_arn'],
]);

/** The bucket a notification is of: by reference, by ARN, or by its name written out. */
const bucketOf = (notification: Instance, reading: ResourceReading): string | Because => {
  const value = argument(notification, 'bucket');
  const referenced = value === undefined ? undefined : deployedOf(value, reading);
  if (referenced !== undefined) return isBecause(referenced) ? referenced : referenced.name;
  const text = textOf(value);
  if (text === undefined) return whyNot(value, 'bucket');
  return deployedInText(text)?.name ?? text;
};

/** The texts of a list, or why it is not one of texts. */
const textsOf = (value: Value | undefined, what: string): string[] | Because => {
  if (value?.kind !== 'list') return whyNot(value, what);
  const texts = value.items.map((item) => asText(item));
  return texts.every((text) => text !== undefined) ? (texts as string[]) : { reason: 'not-a-string', text: `${what} holds a value that is not read` };
};

/** A filter on the keys: absent, written out, or not read. */
const filterOf = (entries: ReadonlyMap<string, Value>, name: string, what: string): string | undefined | Because => {
  const value = entries.get(name);
  if (value === undefined || value.kind === 'null') return undefined;
  return asText(value) ?? whyNot(value, what);
};

const readTarget = (notification: Instance, bucket: string, block: string, arn: string, value: Value, index: number, reading: ResourceReading): void => {
  const address = `${notification.address}.${block}[${index}]`;
  const what = `the ${block} block ${address}`;
  if (value.kind !== 'object') {
    reading.rows.push(unreadRow(notification, 'bucket-notification-unread', what, whyNot(value, what)));
    return;
  }
  const events = textsOf(value.entries.get('events'), `the events of ${address}`);
  const prefix = filterOf(value.entries, 'filter_prefix', `the filter_prefix of ${address}`);
  const suffix = filterOf(value.entries, 'filter_suffix', `the filter_suffix of ${address}`);
  if (!Array.isArray(events)) {
    reading.rows.push(unreadRow(notification, 'bucket-notification-unread', what, events));
    return;
  }
  const unread = [prefix, suffix].find((filter): filter is Because => typeof filter === 'object');
  if (unread !== undefined) {
    reading.rows.push(unreadRow(notification, 'bucket-notification-unread', what, unread));
    return;
  }
  const target = value.entries.get(arn);
  const to = targetOf(target === undefined ? undefined : deployedOfValue(target, `${arn} of ${address}`, reading), notification, `what ${address} notifies`, reading);
  const id = asText(value.entries.get('id') ?? { kind: 'null' });
  reading.deliveries.push({
    ...siteOf(notification),
    address,
    by: 'notification',
    ...(id === undefined ? {} : { name: id }),
    from: {
      kind: 'bucket',
      name: bucket,
      events,
      ...(typeof prefix === 'string' ? { prefix } : {}),
      ...(typeof suffix === 'string' ? { suffix } : {}),
    },
    ...(to === undefined ? {} : { to }),
  });
};

/** The bucket's events on the default bus, one delivery per family a write fires. */
const readEventBridge = (notification: Instance, bucket: string, reading: ResourceReading): void => {
  const value = argument(notification, 'eventbridge');
  if (value === undefined || value.kind === 'null' || (value.kind === 'bool' && !value.value)) return;
  if (value.kind !== 'bool') {
    reading.rows.push(unreadRow(notification, 'bucket-notification-unread', `whether ${notification.address} sends to EventBridge`, whyNot(value, 'eventbridge')));
    return;
  }
  for (const [family, detailType] of Object.entries(S3_DETAIL_TYPES)) {
    reading.deliveries.push({
      ...siteOf(notification),
      address: `${notification.address}.eventbridge["${detailType}"]`,
      by: 'notification',
      from: { kind: 'bucket', name: bucket, events: [family] },
      to: { kind: 'bus', name: DEFAULT_EVENT_BUS, fields: { source: S3_EVENT_SOURCE, 'detail-type': detailType } },
      meta: { eventbridge: true },
    });
  }
};

const readNotification = (notification: Instance, reading: ResourceReading): void => {
  const bucket = bucketOf(notification, reading);
  if (typeof bucket !== 'string') {
    reading.rows.push(unreadRow(notification, 'bucket-notification-unread', `the bucket ${notification.address} notifies of`, bucket));
    return;
  }
  for (const [block, arn] of TARGET_BLOCKS) {
    notification.module.nested(notification, block).forEach((value, index) => readTarget(notification, bucket, block, arn, value, index, reading));
  }
  readEventBridge(notification, bucket, reading);
};

export const BUCKET_READERS: readonly ResourceReader[] = [['aws_s3_bucket_notification', readNotification]];
