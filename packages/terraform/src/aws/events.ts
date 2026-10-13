import type { DeliverySource, DeployedDelivery } from '@flowatlas/core';
import type { Instance } from '../eval/values.js';
import { argument, blockOrArgument, entryOf, siteOf, textOf, unreadRow, whyNot } from './arguments.js';
import { busOf, deployedAt, deployedOfValue, isBecause, targetOf } from './deployed.js';
import { readEventPattern } from './event-pattern.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * Event rules, their targets, and schedules.
 *
 * A rule is where an EventBridge channel gets its subscriber: its pattern says
 * which events it takes, from which bus, and each of its targets is a
 * subscriber - a function, a workflow, a queue, a topic, another bus. A rule
 * with a `schedule_expression` instead takes nothing from a bus and fires on a
 * clock, which is a way in of its own; so does a schedule of EventBridge
 * Scheduler. Every one of them is read from the target, because a rule with no
 * target delivers nothing and a rule with three delivers to three things.
 */

/** The rule a target names, by reference or by the rule's name. */
const ruleOf = (target: Instance, reading: ResourceReading): Instance | undefined => {
  const value = argument(target, 'rule');
  if (value === undefined) return undefined;
  const via = 'via' in value ? value.via?.target : undefined;
  const referenced = value.kind === 'ref' ? value.target : value.kind === 'instance' ? value.instance : via;
  if (referenced?.type === 'aws_cloudwatch_event_rule') return referenced;
  const name = textOf(value);
  return name === undefined
    ? undefined
    : reading.ofType('managed', 'aws_cloudwatch_event_rule').find((rule) => textOf(argument(rule, 'name')) === name);
};

/** Whether a rule or a schedule is switched off. */
const disabled = (instance: Instance): boolean => {
  const enabled = argument(instance, 'is_enabled');
  return textOf(argument(instance, 'state')) === 'DISABLED' || (enabled?.kind === 'bool' && !enabled.value);
};

/** Whether the message a target is handed is not the event itself. */
const transformed = (target: Instance): boolean =>
  ['input', 'input_path', 'input_transformer'].some((name) => {
    const value = argument(target, name);
    return (value !== undefined && value.kind !== 'null') || target.module.nested(target, name).length > 0;
  });

const readRuleTarget = (target: Instance, reading: ResourceReading): void => {
  const rule = ruleOf(target, reading);
  if (rule === undefined) {
    reading.rows.push(unreadRow(target, 'subscription-source-unread', `the rule ${target.address} belongs to`, whyNot(argument(target, 'rule'), 'rule')));
    return;
  }
  const name = textOf(argument(rule, 'name'));
  const schedule = argument(rule, 'schedule_expression');
  let from: DeliverySource;
  if (schedule !== undefined && schedule.kind !== 'null') {
    from = { kind: 'schedule', ...(textOf(schedule) === undefined ? {} : { expression: textOf(schedule) as string }) };
  } else {
    const bus = busOf(argument(target, 'event_bus_name') ?? argument(rule, 'event_bus_name'), `the bus of ${rule.address}`, reading);
    if (typeof bus !== 'string') {
      reading.rows.push(unreadRow(rule, 'subscription-source-unread', `the bus ${rule.address} takes events from`, bus));
      return;
    }
    const pattern = readEventPattern(argument(rule, 'event_pattern'));
    if (pattern === undefined) {
      reading.rows.push(unreadRow(rule, 'event-pattern-unread', `the events ${rule.address} takes`, { reason: 'absent', text: 'it has neither an event_pattern nor a schedule_expression' }));
      return;
    }
    if ('reason' in pattern) {
      reading.rows.push(unreadRow(rule, 'event-pattern-unread', `the event_pattern of ${rule.address}`, pattern));
      return;
    }
    from = { kind: 'bus', name: bus, pattern };
  }
  const to = targetOf(deployedAt(target, 'arn', reading), target, `the target of ${target.address}`, reading);
  const delivery: DeployedDelivery = {
    ...siteOf(target),
    address: target.address,
    by: from.kind === 'schedule' ? 'schedule' : 'rule',
    ...(name === undefined ? {} : { name }),
    from,
    ...(to === undefined ? {} : { to }),
    meta: {
      rule: rule.address,
      ...(disabled(rule) ? { disabled: true } : {}),
      ...(transformed(target) ? { transformed: true } : {}),
    },
  };
  reading.deliveries.push(delivery);
};

/** EventBridge Scheduler: a schedule with one target, written as a nested block. */
const readSchedule = (schedule: Instance, reading: ResourceReading): void => {
  const name = textOf(argument(schedule, 'name'));
  const expression = textOf(argument(schedule, 'schedule_expression'));
  const target = blockOrArgument(schedule, 'target');
  const arn = entryOf(target, 'arn');
  const to = targetOf(
    arn === undefined ? undefined : deployedOfValue(arn, `the target of ${schedule.address}`, reading),
    schedule,
    `the target of ${schedule.address}`,
    reading,
  );
  reading.deliveries.push({
    ...siteOf(schedule),
    address: schedule.address,
    by: 'schedule',
    ...(name === undefined ? {} : { name }),
    from: { kind: 'schedule', ...(expression === undefined ? {} : { expression }) },
    ...(to === undefined ? {} : { to }),
    ...(disabled(schedule) ? { meta: { disabled: true } } : {}),
  });
};

export const EVENT_READERS: readonly ResourceReader[] = [
  ['aws_cloudwatch_event_target', readRuleTarget],
  ['aws_scheduler_schedule', readSchedule],
];
