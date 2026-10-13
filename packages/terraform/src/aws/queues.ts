import type { DeliverySource } from '@flowatlas/core';
import { asText, type Because, type Instance, type Value } from '../eval/values.js';
import { argument, blockOrArgument, siteOf, textOf, unreadRow, whyNot } from './arguments.js';
import { deployedAt, deployedInText, deployedOf, deployedOfValue, isBecause, targetOf, type Deployed } from './deployed.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * Queues, topics and streams, and what reads each.
 *
 * A function reads a queue or a stream through a mapping the platform polls
 * for it; a topic hands each message to its subscriptions; a queue hands what
 * its readers failed on to its dead-letter queue. None of these is written in
 * the code that reads the message, which only ever sees the batch it is given.
 */

/** Where a mapping or a pipe reads from, as a delivery's source, or why it cannot be one. */
export const sourceOf = (found: Deployed): DeliverySource | Because => {
  switch (found.kind) {
    case 'queue':
      return { kind: 'queue', name: found.name };
    case 'topic':
      return { kind: 'topic', name: found.name };
    case 'stream':
      return { kind: 'changes', of: 'stream', name: found.name };
    case 'table':
      return found.changes === true
        ? { kind: 'changes', of: 'table', name: found.name }
        : { reason: 'unplaced', text: `it is the table ${found.name} rather than its stream` };
    default:
      return { reason: 'unplaced', text: `it is a ${found.kind} (${found.name}), which is not read from in order` };
  }
};

/**
 * A function named by a reference, an ARN, or its bare name: a reference to a
 * function this deployment creates is that function, whichever of its
 * attributes it reads, and any other text that is not an ARN is a name.
 */
export const functionAt = (instance: Instance, name: string, reading: ResourceReading): Deployed | Because | undefined => {
  const value = argument(instance, name);
  const referenced = value === undefined ? undefined : deployedOf(value, reading);
  if (referenced !== undefined) return referenced;
  const text = textOf(value);
  if (text !== undefined && deployedInText(text) === undefined) return { kind: 'function', name: text };
  return deployedAt(instance, name, reading);
};

/** The filter patterns of a `filter_criteria`, as written: recorded, not matched on. */
export const filtersIn = (criteria: Value | undefined): string[] => {
  const filters = criteria?.kind === 'object' ? criteria.entries.get('filter') : undefined;
  const list = filters?.kind === 'list' ? filters.items : filters === undefined ? [] : [filters];
  return list.flatMap((filter) => {
    const pattern = filter.kind === 'object' ? filter.entries.get('pattern') : undefined;
    const text = pattern === undefined ? undefined : asText(pattern);
    return text === undefined ? [] : [text];
  });
};

const readMapping = (mapping: Instance, reading: ResourceReading): void => {
  const found = deployedAt(mapping, 'event_source_arn', reading);
  if (found === undefined) {
    reading.rows.push(
      unreadRow(mapping, 'subscription-source-unread', `what ${mapping.address} reads`, { reason: 'unplaced', text: 'it reads a source other than a queue or a stream' }, 'info'),
    );
    return;
  }
  const from = isBecause(found) ? found : sourceOf(found);
  if ('reason' in from) {
    reading.rows.push(unreadRow(mapping, 'subscription-source-unread', `what ${mapping.address} reads`, from, from.reason === 'unplaced' ? 'info' : undefined));
    return;
  }
  const to = targetOf(functionAt(mapping, 'function_name', reading), mapping, `the function ${mapping.address} hands its batches to`, reading);
  const enabled = argument(mapping, 'enabled');
  const filters = filtersIn(blockOrArgument(mapping, 'filter_criteria'));
  reading.deliveries.push({
    ...siteOf(mapping),
    address: mapping.address,
    by: 'mapping',
    from,
    ...(to === undefined ? {} : { to }),
    meta: {
      ...(enabled?.kind === 'bool' && !enabled.value ? { disabled: true } : {}),
      ...(filters.length === 0 ? {} : { unmatched: { filter: filters } }),
    },
  });
};

/** Protocols a subscription delivers to something this reading follows. */
const FOLLOWED_PROTOCOLS = new Set(['lambda', 'sqs']);

const readSubscription = (subscription: Instance, reading: ResourceReading): void => {
  const topic = deployedAt(subscription, 'topic_arn', reading);
  if (topic === undefined || isBecause(topic) || topic.kind !== 'topic') {
    const because = topic === undefined ? whyNot(undefined, 'topic_arn') : isBecause(topic) ? topic : { reason: 'unplaced', text: `topic_arn names a ${topic.kind}` };
    reading.rows.push(unreadRow(subscription, 'subscription-source-unread', `the topic ${subscription.address} subscribes to`, because));
    return;
  }
  const protocol = textOf(argument(subscription, 'protocol'));
  const what = `what ${subscription.address} delivers to`;
  const to =
    protocol !== undefined && FOLLOWED_PROTOCOLS.has(protocol)
      ? targetOf(protocol === 'lambda' ? functionAt(subscription, 'endpoint', reading) : deployedAt(subscription, 'endpoint', reading), subscription, what, reading)
      : targetOf(
          { reason: 'unplaced', text: `it delivers by ${protocol ?? 'a protocol not read'}, which nothing here follows` },
          subscription,
          what,
          reading,
        );
  const policy = textOf(argument(subscription, 'filter_policy'));
  const raw = argument(subscription, 'raw_message_delivery');
  reading.deliveries.push({
    ...siteOf(subscription),
    address: subscription.address,
    by: 'subscription',
    from: { kind: 'topic', name: topic.name },
    ...(to === undefined ? {} : { to }),
    meta: {
      ...(protocol === undefined ? {} : { protocol }),
      ...(policy === undefined ? {} : { unmatched: { filter_policy: policy } }),
      ...(raw?.kind === 'bool' && raw.value ? { raw: true } : {}),
    },
  });
};

/**
 * The queue a redrive policy sends failures to.
 *
 * Written as JSON text (a heredoc, or `jsonencode` of what the files settle),
 * or as `jsonencode` of an object holding the dead-letter queue's reference,
 * which evaluates to a document nobody can finish around a reference that
 * names the queue all the same.
 */
const deadLetterOf = (value: Value | undefined, what: string, reading: ResourceReading): Deployed | Because | undefined => {
  if (value === undefined || value.kind === 'null') return undefined;
  if (value.kind === 'string') {
    let arn: unknown;
    try {
      arn = (JSON.parse(value.value) as Record<string, unknown>)['deadLetterTargetArn'];
    } catch {
      return { reason: 'not-json', text: `${what} is not JSON` };
    }
    return typeof arn === 'string' ? deployedOfValue({ kind: 'string', value: arn }, what, reading) : { reason: 'absent', text: `${what} names no dead-letter queue` };
  }
  const document = value.kind === 'unknown' ? value.partial : value;
  const target = document?.kind === 'object' ? document.entries.get('deadLetterTargetArn') : undefined;
  if (target !== undefined) return deployedOfValue(target, what, reading);
  return whyNot(value, what);
};

const pushRedrive = (owner: Instance, queue: Deployed | Because | undefined, policy: Value | undefined, reading: ResourceReading): void => {
  const what = `the redrive policy of ${owner.address}`;
  const deadLetter = deadLetterOf(policy, what, reading);
  if (deadLetter === undefined) return;
  if (queue === undefined || isBecause(queue) || queue.kind !== 'queue') {
    const because = queue === undefined ? whyNot(undefined, 'the queue') : isBecause(queue) ? queue : { reason: 'unplaced', text: `it names a ${queue.kind}` };
    reading.rows.push(unreadRow(owner, 'subscription-source-unread', `the queue ${owner.address} redrives`, because));
    return;
  }
  const to = targetOf(deadLetter, owner, `the dead-letter queue of ${owner.address}`, reading);
  const count = policy?.kind === 'unknown' && policy.partial?.kind === 'object' ? policy.partial.entries.get('maxReceiveCount') : undefined;
  const receives = count?.kind === 'number' ? count.value : undefined;
  reading.deliveries.push({
    ...siteOf(owner),
    address: owner.address,
    by: 'redrive',
    from: { kind: 'queue', name: queue.name },
    ...(to === undefined ? {} : { to }),
    ...(receives === undefined ? {} : { meta: { maxReceiveCount: receives } }),
  });
};

const readQueue = (queue: Instance, reading: ResourceReading): void =>
  pushRedrive(queue, deployedOf({ kind: 'instance', instance: queue }, reading), argument(queue, 'redrive_policy'), reading);

const readRedrivePolicy = (policy: Instance, reading: ResourceReading): void =>
  pushRedrive(policy, deployedAt(policy, 'queue_url', reading), argument(policy, 'redrive_policy'), reading);

export const QUEUE_READERS: readonly ResourceReader[] = [
  ['aws_lambda_event_source_mapping', readMapping],
  ['aws_sns_topic_subscription', readSubscription],
  ['aws_sqs_queue', readQueue],
  ['aws_sqs_queue_redrive_policy', readRedrivePolicy],
];
