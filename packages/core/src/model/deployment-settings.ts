/**
 * The rows a deployment's settings and the code it runs make together (P389):
 * where the two contradict each other, and where a check could not be made.
 *
 * Kept apart from the registry of every reason (`row-kind.ts`), which takes
 * these lists whole, so the checks that write them and the reasons they write
 * are stated side by side and a new check is a line here.
 *
 * - `batch-failures-unreported`: a mapping from a queue says its function
 *   reports which messages failed, and the function never returns
 *   `batchItemFailures`: an answer without them is a batch that succeeded, so
 *   every message is deleted, the failed ones too.
 * - `batch-failures-ignored`: the function returns `batchItemFailures` and the
 *   mapping does not say it reports them, so the platform ignores the list and
 *   a failed message is retried only when the whole batch throws.
 * - `queue-visibility-short`: a queue hides a message it handed out for less
 *   than six times its reader's timeout (plus the batch window): a message can
 *   come back while it is still being processed, and be processed twice.
 * - `queue-redrive-missing`: a queue a function reads has no redrive policy, so
 *   a message that always fails is retried until it expires.
 * - `queue-receives-few`: its redrive policy hands a message on after fewer
 *   than five receives, too few for a throttled function's retries.
 * - `workflow-task-untimed`: a task that waits on an activity, a `.sync` job or
 *   a task token has no `TimeoutSeconds`, and neither has its state machine:
 *   it waits for ever for an answer that never comes.
 * - `workflow-callback-no-heartbeat`: a task-token callback has no
 *   `HeartbeatSeconds`, so a worker that died is noticed only at the timeout.
 * - `workflow-function-unretried`: a task invoking a function retries none of
 *   the platform's transient errors.
 */
export const DEPLOYMENT_SETTING_FINDINGS: readonly string[] = [
  'batch-failures-unreported',
  'batch-failures-ignored',
  'queue-visibility-short',
  'queue-redrive-missing',
  'queue-receives-few',
  'workflow-task-untimed',
  'workflow-callback-no-heartbeat',
  'workflow-function-unretried',
];

/** A check of a deployment's settings that was not made, and why: a value the files do not settle, code not read. */
export const DEPLOYMENT_SETTING_NOTES: readonly string[] = ['deployment-setting-unread'];
