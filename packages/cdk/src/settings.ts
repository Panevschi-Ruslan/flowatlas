import { FUNCTION_TIMEOUT_DEFAULT, QUEUE_VISIBILITY_DEFAULT } from '@flowatlas/aws';
import type { DeployedQueue, DeployedSeconds, MappingBatch } from '@flowatlas/core';
import { durationOf } from './statics.js';
import { handedOn, ObjectValue, Unread, type Value } from './values.js';

/**
 * The settings a function, a queue and a mapping between them are held to
 * (P389), as an app writes them: a function's `timeout`, a queue's
 * `visibilityTimeout` and `deadLetterQueue`, an event source's
 * `reportBatchItemFailures` and `maxBatchingWindow`, each a `Duration` where
 * it is a time. A setting left out is the library's default, which is the
 * platform's.
 */

const SECONDS: Readonly<Record<string, number>> = { second: 1, minute: 60, hour: 3600, day: 86400 };

/** A duration as seconds, the default where nothing is written. */
export const secondsOfDuration = (written: Value, defaultSeconds: number | undefined, what: string): DeployedSeconds | undefined => {
  const value = handedOn(written);
  if (value === undefined || value === null) return defaultSeconds === undefined ? undefined : { seconds: defaultSeconds, defaulted: true };
  if (value instanceof Unread) return { unread: `${what} is not read: ${value.text}` };
  const duration = durationOf(value);
  if (duration === undefined) return { unread: `${what} is not a Duration the app settles` };
  return { seconds: duration.amount * (SECONDS[duration.unit] ?? 1) };
};

/** How long a function runs at most. */
export const functionTimeout = (written: Value, what: string): DeployedSeconds | undefined =>
  secondsOfDuration(written, FUNCTION_TIMEOUT_DEFAULT, `the timeout of ${what}`);

/** What an event source or a mapping from a queue tells the platform about its batches. */
export const batchOf = (options: Value, what: string): MappingBatch => {
  const props = options instanceof ObjectValue ? options : undefined;
  const reports = handedOn(props?.get('reportBatchItemFailures'));
  const window = secondsOfDuration(props?.get('maxBatchingWindow'), 0, `the batch window of ${what}`);
  return {
    reportsItemFailures:
      reports === undefined || reports === null || typeof reports === 'boolean'
        ? reports === true
        : { unread: `whether ${what} reports the messages of a batch that failed is not read${reports instanceof Unread ? `: ${reports.text}` : ''}` },
    ...(window === undefined ? {} : { window }),
  };
};

/** A queue the app creates, with its visibility timeout and whether it is handed a dead-letter queue. */
export const queueOf = (site: { readonly file: string; readonly line: number }, address: string, name: string, visibility: Value, deadLetter: Value): DeployedQueue => {
  const seconds = secondsOfDuration(visibility, QUEUE_VISIBILITY_DEFAULT, `the visibility timeout of ${address}`);
  return { ...site, address, name, ...(seconds === undefined ? {} : { visibilityTimeout: seconds }), redrive: deadLetter === undefined || deadLetter === null ? 'none' : 'written' };
};
