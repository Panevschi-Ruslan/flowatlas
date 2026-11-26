import { FUNCTION_TIMEOUT_DEFAULT, QUEUE_VISIBILITY_DEFAULT, REPORT_BATCH_ITEM_FAILURES } from '@flowatlas/aws';
import type { DeployedSeconds, MappingBatch } from '@flowatlas/core';
import type { Instance, Value } from '../eval/values.js';
import { argument, listed, siteOf, textOf, whyNot } from './arguments.js';
import { deployedOf, isBecause } from './deployed.js';
import type { ResourceReading } from './reading.js';

/**
 * The settings a function, a queue and a mapping between them are held to
 * (P389), as the provider's arguments write them: `timeout`,
 * `visibility_timeout_seconds` and `redrive_policy`,
 * `function_response_types` and `maximum_batching_window_in_seconds`. An
 * argument left out is the provider's default, which is the platform's.
 */

/** Why a value is not read, said with what it is the value of. */
const unreadText = (value: Value, what: string): string => (value.kind === 'unknown' ? `${what} is not read: ${value.because.text}` : whyNot(value, what).text);

/** A number of seconds an argument writes, the default where it writes none. */
export const secondsArgument = (instance: Instance, name: string, defaultSeconds: number | undefined): DeployedSeconds | undefined => {
  const value = argument(instance, name);
  // A module described rather than read writes only what its description
  // says: an argument it leaves out is not known to be left out.
  if (value === undefined && instance.module.site !== undefined) return { unread: `the description of the module that creates ${instance.address} does not write its ${name}` };
  if (value === undefined || value.kind === 'null') return defaultSeconds === undefined ? undefined : { seconds: defaultSeconds, defaulted: true };
  if (value.kind === 'number') return { seconds: value.value };
  const text = textOf(value);
  if (text !== undefined && /^\d+(?:\.\d+)?$/.test(text.trim())) return { seconds: Number(text) };
  return { unread: unreadText(value, `the ${name} of ${instance.address}`) };
};

/** How long a function runs at most. */
export const functionTimeout = (instance: Instance): DeployedSeconds | undefined => secondsArgument(instance, 'timeout', FUNCTION_TIMEOUT_DEFAULT);

/** What a mapping from a queue tells the platform about its batches. */
export const mappingBatch = (mapping: Instance): MappingBatch => {
  const types = argument(mapping, 'function_response_types');
  const reports: MappingBatch['reportsItemFailures'] =
    types === undefined || types.kind === 'null'
      ? false
      : types.kind === 'list'
        ? listed(types).some((item) => textOf(item) === REPORT_BATCH_ITEM_FAILURES)
          ? true
          : listed(types).every((item) => textOf(item) !== undefined)
            ? false
            : { unread: `the function_response_types of ${mapping.address} are not all read` }
        : { unread: unreadText(types, `the function_response_types of ${mapping.address}`) };
  const window = secondsArgument(mapping, 'maximum_batching_window_in_seconds', 0);
  return { reportsItemFailures: reports, ...(window === undefined ? {} : { window }) };
};

/** A queue the configuration declares, with its visibility timeout and whether it writes a redrive policy. */
export const readQueueSettings = (queue: Instance, reading: ResourceReading): void => {
  const found = deployedOf({ kind: 'instance', instance: queue }, reading);
  if (found === undefined || isBecause(found) || found.kind !== 'queue') return;
  const policy = argument(queue, 'redrive_policy');
  const visibility = secondsArgument(queue, 'visibility_timeout_seconds', QUEUE_VISIBILITY_DEFAULT);
  reading.queues.push({
    ...siteOf(queue),
    address: queue.address,
    name: found.name,
    ...(visibility === undefined ? {} : { visibilityTimeout: visibility }),
    ...(policy === undefined && queue.module.site !== undefined ? {} : { redrive: policy === undefined || policy.kind === 'null' ? 'none' : 'written' }),
  });
};
