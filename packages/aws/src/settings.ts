/**
 * What the platform does with the settings a deployment leaves out, and what
 * it recommends a reader of a queue and a task of a workflow be held to (P389),
 * stated once for every reader of a deployment and the checks that compare
 * them with the code.
 *
 * Each figure is the platform's own, from its documentation:
 *
 * - a function runs for 3 seconds at most where its timeout is not written;
 * - a queue hides a message it handed out for 30 seconds where its visibility
 *   timeout is not written;
 * - a queue a function reads should hide a message for at least six times the
 *   function's timeout, plus the mapping's batch window; under the timeout
 *   itself the mapping is refused when it is created, and a timeout raised
 *   later is not checked;
 * - its redrive policy should hand a message on after at least five receives;
 * - a mapping whose function reports which messages failed says
 *   `ReportBatchItemFailures`, and the function answers `{ batchItemFailures }`;
 * - a task invoking a function should retry the platform's transient errors.
 */
import type { DeployedSeconds } from '@flowatlas/core';

/** Seconds a function runs at most where its deployment writes no timeout. */
export const FUNCTION_TIMEOUT_DEFAULT = 3;

/** Seconds a queue hides a message it handed out where its deployment writes no visibility timeout. */
export const QUEUE_VISIBILITY_DEFAULT = 30;

/** How many times its reader's timeout a queue should hide a message for. */
export const VISIBILITY_TIMES_TIMEOUT = 6;

/** The fewest receives a redrive policy should allow before handing a message on. */
export const RECEIVES_AT_LEAST = 5;

/** The function response type a mapping says its function reports failed messages by. */
export const REPORT_BATCH_ITEM_FAILURES = 'ReportBatchItemFailures';

/** The field of a function's answer that lists the messages of a batch that failed. */
export const BATCH_FAILURES_FIELD = 'batchItemFailures';

/**
 * Packages whose helpers build that answer for a handler: Powertools' batch
 * processing (`processPartialResponse`, a processor's `response()`) and the
 * middleware that answers for a handler that throws per record.
 */
export const BATCH_ANSWER_PACKAGES: readonly string[] = ['@aws-lambda-powertools/batch', '@middy/sqs-partial-batch-failure'];

/** The errors invoking a function fails with that are the platform's and pass; a retry of any of them, or of a wildcard, is a retry of them. */
export const FUNCTION_TRANSIENT_ERRORS: readonly string[] = [
  'Lambda.ServiceException',
  'Lambda.AWSLambdaException',
  'Lambda.SdkClientException',
  'Lambda.ClientExecutionTimeoutException',
  'Lambda.TooManyRequestsException',
];

/** Error names that match every error a function's invocation fails with. */
export const RETRY_WILDCARDS: readonly string[] = ['States.ALL', 'States.TaskFailed'];

/**
 * A number of seconds as a deployment writes it in a plain document: a
 * number, or text that is one; the default where nothing is written; and,
 * where something else is, unread with what it was written as.
 */
export const secondsWritten = (value: unknown, defaultSeconds: number | undefined, what: string): DeployedSeconds | undefined => {
  if (value === undefined || value === null) return defaultSeconds === undefined ? undefined : { seconds: defaultSeconds, defaulted: true };
  if (typeof value === 'number' && Number.isFinite(value)) return { seconds: value };
  if (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) return { seconds: Number(value) };
  return { unread: `${what} is written as ${typeof value === 'string' ? value : JSON.stringify(value)}, which the files do not settle` };
};
