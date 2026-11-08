import { destinationOf } from '@flowatlas/aws';
import { alternativeAddress, alternativeOf, importedName, type DeliverySource, type DeployedKind } from '@flowatlas/core';
import type { Instance, Value } from '../eval/values.js';
import { blockOrArgument, entryOf, siteOf, unreadRow } from './arguments.js';
import { alternativesAt, asTarget, deployedOfValue, importAt, isBecause, targetOf } from './deployed.js';
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


/** What a mapping hands the batches it gives up on to (P253). */
const MAPPING_DESTINATION_KINDS: readonly DeployedKind[] = ['queue', 'topic'];

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
    const found = deployedOfValue(value, what, reading);
    // A destination another deployment writes to a parameter of the account, which the use does not say the kind of (P253).
    if (isBecause(found) && found.imported !== undefined) {
      const kinds = at === 'destination_arn' ? MAPPING_DESTINATION_KINDS : (['queue', 'topic', 'bus', 'function'] as const);
      for (const alternative of alternativesAt(reading, owner, found.imported, kinds, what, `${owner.address}.${block}`)) {
        const to = destinationOf(asTarget(alternative), when);
        reading.deliveries.push({ ...siteOf(owner), address: alternative.address, by: 'destination', from: { kind: 'outcome', when, of }, ...(to === undefined ? {} : { to }), meta: { when } });
      }
      continue;
    }
    const to = destinationOf(targetOf(found, owner, what, reading), when);
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

/**
 * An invoke configuration: the function's results, to the destinations it
 * names. A function another deployment creates is named, and joined to its
 * entry by the linker wherever it is declared (P60).
 */
const readInvokeConfig: ResourceReader[1] = (config, reading) => {
  if (destinationsIn(config, 'destination').length === 0) return;
  const found = functionAt(config, 'function_name', reading);
  if (found !== undefined && !isBecause(found) && found.kind === 'function') {
    push(config, found.function === undefined ? { name: found.name } : { function: found.function }, reading, 'destination');
    return;
  }
  const because =
    found === undefined
      ? { reason: 'absent', text: 'nothing names the function' }
      : isBecause(found)
        ? found
        : { reason: 'unplaced', text: `${found.name} is not a function` };
  reading.rows.push(unreadRow(config, 'subscription-source-unread', `the function ${config.address} hands results on from`, because, 'info'));
};

/**
 * The failures of a mapping read once per kind of thing it may read, where
 * what it reads is a value another deployment publishes (P253): from each
 * reading's own way in, under an address of the reading's kind, which the
 * import's site is told of, so the linker keeps a destination with the
 * reading it belongs to and drops it with the others (P259). A destination
 * that is itself such a value is a choice inside each reading's choice
 * (P261): drawn once per kind it may be under each reading's address, its
 * own import's site listing them, so the linker keeps the one of the kind
 * its publisher's value is, of the reading the mapping's publisher's is, and
 * renames it back through both.
 */
const pushOfReadings = (mapping: Instance, readings: readonly { readonly address: string; readonly kind: string }[], reading: ResourceReading): void => {
  for (const [block, when, value] of destinationsIn(mapping, 'destination_arn')) {
    const what = `the ${when} destination of ${mapping.address}`;
    const found = deployedOfValue(value, what, reading);
    const imported = isBecause(found) ? found.imported : undefined;
    const to = imported === undefined ? destinationOf(targetOf(found, mapping, what, reading), when) : undefined;
    /** The destination's readings, under each reading of the mapping. */
    const inner: { kind: DeployedKind; address: string }[] = [];
    for (const one of readings) {
      const address = alternativeAddress(`${mapping.address}.${block}`, one.kind);
      const from = { kind: 'outcome', when, of: { delivery: one.address } } as const;
      if (imported === undefined) {
        reading.deliveries.push({ ...siteOf(mapping), address, by: 'destination', from, ...(to === undefined ? {} : { to }), meta: { when } });
      } else {
        for (const kind of MAPPING_DESTINATION_KINDS) {
          const alternative = { kind, address: alternativeAddress(address, kind) };
          inner.push(alternative);
          const target = destinationOf(asTarget({ kind, name: importedName(imported) }), when);
          reading.deliveries.push({ ...siteOf(mapping), address: alternative.address, by: 'destination', from, ...(target === undefined ? {} : { to: target }), meta: { when } });
        }
      }
      const index = reading.imports.findIndex((site) => site.alternatives?.some((alternative) => alternative.address === one.address) === true);
      const site = reading.imports[index];
      if (site?.alternatives !== undefined) reading.imports[index] = { ...site, alternatives: [...site.alternatives, { kind: one.kind as (typeof site.alternatives)[number]['kind'], address }] };
    }
    if (imported !== undefined) importAt(reading, mapping, imported, what, MAPPING_DESTINATION_KINDS, inner);
  }
};

/**
 * A mapping's failures: what it gave up on, from where its batches came in.
 * Read after every mapping, so the mapping's own delivery - or each of its
 * readings (P259) - is there to start from.
 */
const readMappingFailure: ResourceReader[1] = (mapping, reading) => {
  if (reading.deliveries.some((delivery) => delivery.address === mapping.address)) {
    push(mapping, { delivery: mapping.address }, reading, 'destination_arn');
    return;
  }
  const readings = reading.deliveries.flatMap((delivery) => {
    const alternative = delivery.by === 'mapping' ? alternativeOf(delivery.address) : undefined;
    return alternative?.address === mapping.address ? [{ address: delivery.address, kind: alternative.kind }] : [];
  });
  if (readings.length > 0) pushOfReadings(mapping, readings, reading);
};

export const DESTINATION_READERS: readonly ResourceReader[] = [
  ['aws_lambda_function_event_invoke_config', readInvokeConfig],
  ['aws_lambda_event_source_mapping', readMappingFailure],
];
