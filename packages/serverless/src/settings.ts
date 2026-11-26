import { FUNCTION_TIMEOUT_DEFAULT, QUEUE_VISIBILITY_DEFAULT, REPORT_BATCH_ITEM_FAILURES, secondsWritten } from '@flowatlas/aws';
import type { DeployedQueue, DeployedSeconds, MappingBatch } from '@flowatlas/core';
import { isRecord, Unread } from './variables.js';

/**
 * The settings a function, a queue and a mapping between them are held to
 * (P389), as a service file and a CloudFormation template write them: a
 * function's `timeout` (`Timeout`), a queue's `VisibilityTimeout` and
 * `RedrivePolicy`, a mapping's response types and batch window. A setting
 * left out is the default of the format that writes it: the Serverless
 * Framework deploys a function for 6 seconds, CloudFormation and SAM for the
 * platform's 3.
 */

/** Seconds the Serverless Framework deploys a function for where neither it nor the provider writes a timeout. */
export const SERVICE_TIMEOUT_DEFAULT = 6;

/** A number of seconds as written, a value the files do not settle said as unread. */
export const secondsIn = (value: unknown, defaultSeconds: number | undefined, what: string): DeployedSeconds | undefined =>
  value instanceof Unread ? { unread: `${what} is not read: ${value.text}` } : secondsWritten(value, defaultSeconds, what);

/** A CloudFormation function's timeout: `Timeout`, the platform's 3 seconds where it is not written. */
export const templateTimeout = (properties: Record<string, unknown>, what: string): DeployedSeconds | undefined =>
  secondsIn(properties['Timeout'], FUNCTION_TIMEOUT_DEFAULT, `the timeout of ${what}`);

/** Whether a list of function response types, or one written alone, holds `ReportBatchItemFailures`. */
const reportsIn = (types: unknown, what: string): MappingBatch['reportsItemFailures'] => {
  if (types === undefined || types === null) return false;
  if (types instanceof Unread) return { unread: `${what} are not read: ${types.text}` };
  const list = Array.isArray(types) ? types : [types];
  if (list.includes(REPORT_BATCH_ITEM_FAILURES)) return true;
  return list.every((item) => typeof item === 'string') ? false : { unread: `${what} are not all read` };
};

/** What a mapping written as CloudFormation (`AWS::Lambda::EventSourceMapping`, a SAM `SQS` event) tells the platform about its batches. */
export const templateBatch = (properties: Record<string, unknown>, what: string): MappingBatch => {
  const window = secondsIn(properties['MaximumBatchingWindowInSeconds'], 0, `the batch window of ${what}`);
  return { reportsItemFailures: reportsIn(properties['FunctionResponseTypes'], `the function response types of ${what}`), ...(window === undefined ? {} : { window }) };
};

/** What an `sqs` event of a service file tells the platform about its batches: `functionResponseType`, `maximumBatchingWindow`. */
export const serviceBatch = (settings: Record<string, unknown>, what: string): MappingBatch => {
  const window = secondsIn(settings['maximumBatchingWindow'], 0, `the batch window of ${what}`);
  return { reportsItemFailures: reportsIn(settings['functionResponseType'], `the function response type of ${what}`), ...(window === undefined ? {} : { window }) };
};

/** A queue a template declares (`AWS::SQS::Queue`), with its visibility timeout and whether it writes a redrive policy. */
export const templateQueue = (
  site: { readonly file: string; readonly line: number },
  address: string,
  name: string,
  properties: Record<string, unknown>,
): DeployedQueue => {
  const visibility = secondsIn(properties['VisibilityTimeout'], QUEUE_VISIBILITY_DEFAULT, `the visibility timeout of ${address}`);
  const policy = properties['RedrivePolicy'];
  return {
    ...site,
    address,
    name,
    ...(visibility === undefined ? {} : { visibilityTimeout: visibility }),
    redrive: policy === undefined || policy === null ? 'none' : 'written',
  };
};

/** The receives a redrive policy allows before handing a message on, where it writes a number. */
export const receivesIn = (policy: unknown): number | undefined => {
  const document = typeof policy === 'string' ? parsed(policy) : policy;
  const receives = isRecord(document) ? document['maxReceiveCount'] : undefined;
  return typeof receives === 'number' ? receives : typeof receives === 'string' && /^\d+$/.test(receives) ? Number(receives) : undefined;
};

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};
