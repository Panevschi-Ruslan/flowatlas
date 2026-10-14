import type { DeliverySource, DeliveryTarget } from '@flowatlas/core';
import type { Instance, Value } from '../eval/values.js';
import { blockOrArgument, entryOf, siteOf, unreadRow } from './arguments.js';
import { deployedOfValue, isBecause, targetOf } from './deployed.js';
import { functionAt } from './queues.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * Where a function's run ends up (P54).
 *
 * A function invoked without anyone waiting for it hands its result on to the
 * destination its invoke configuration names for a success or a failure: a
 * function, a queue, a topic or a bus. A mapping hands a batch it gave up on to
 * the destination its own configuration names. Neither is written in the code
 * that runs, so each is a delivery from the run to the destination, saying
 * which of the two outcomes it carries.
 */

type When = Extract<DeliverySource, { kind: 'outcome' }>['when'];

/** The blocks of a `destination_config`, and the outcome each carries. */
const OUTCOMES: ReadonlyMap<string, When> = new Map([
  ['on_success', 'success'],
  ['on_failure', 'failure'],
]);

/**
 * What an invocation result put on a bus is named by: the platform's own source
 * and detail type, so a rule taking them by name joins it.
 */
const RESULT_DETAIL_TYPES: Readonly<Record<When, string>> = {
  success: 'Lambda Function Invocation Result - Success',
  failure: 'Lambda Function Invocation Result - Failure',
};

/** A destination as a target; a result put on a bus is the event the platform names. */
const destinationOf = (to: DeliveryTarget | undefined, when: When): DeliveryTarget | undefined =>
  to?.kind === 'bus' ? { ...to, fields: { source: 'lambda', 'detail-type': RESULT_DETAIL_TYPES[when] } } : to;

/** Each outcome a `destination_config` hands on, and the value naming where. */
const destinationsIn = (owner: Instance, at: string): (readonly [string, When, Value])[] => {
  const config = blockOrArgument(owner, 'destination_config');
  return [...OUTCOMES].flatMap(([block, when]) => {
    const value = entryOf(entryOf(config, block), at);
    return value === undefined || value.kind === 'null' ? [] : [[block, when, value] as const];
  });
};

const push = (owner: Instance, of: Extract<DeliverySource, { kind: 'outcome' }>['of'], reading: ResourceReading, at: string): void => {
  for (const [block, when, value] of destinationsIn(owner, at)) {
    const what = `the ${when} destination of ${owner.address}`;
    const to = destinationOf(targetOf(deployedOfValue(value, what, reading), owner, what, reading), when);
    reading.deliveries.push({
      ...siteOf(owner),
      address: `${owner.address}.${block}`,
      by: 'destination',
      from: { kind: 'outcome', when, of },
      ...(to === undefined ? {} : { to }),
      meta: { when },
    });
  }
};

/** An invoke configuration: the function's results, to the destinations it names. */
const readInvokeConfig: ResourceReader[1] = (config, reading) => {
  if (destinationsIn(config, 'destination').length === 0) return;
  const found = functionAt(config, 'function_name', reading);
  const index = found === undefined || isBecause(found) ? undefined : found.function;
  if (index === undefined) {
    const because =
      found === undefined
        ? { reason: 'absent', text: 'nothing names the function' }
        : isBecause(found)
          ? found
          : { reason: 'unplaced', text: `${found.name} is not a function this deployment creates` };
    reading.rows.push(unreadRow(config, 'subscription-source-unread', `the function ${config.address} hands results on from`, because, 'info'));
    return;
  }
  push(config, { function: index }, reading, 'destination');
};

/**
 * A mapping's failures: what it gave up on, from where its batches came in.
 * Read after every mapping, so the mapping's own delivery is there to start from.
 */
const readMappingFailure: ResourceReader[1] = (mapping, reading) => {
  if (!reading.deliveries.some((delivery) => delivery.address === mapping.address)) return;
  push(mapping, { delivery: mapping.address }, reading, 'destination_arn');
};

export const DESTINATION_READERS: readonly ResourceReader[] = [
  ['aws_lambda_function_event_invoke_config', readInvokeConfig],
  ['aws_lambda_event_source_mapping', readMappingFailure],
];
