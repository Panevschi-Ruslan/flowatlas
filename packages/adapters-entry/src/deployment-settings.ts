import {
  queueChannel,
  RECEIVES_AT_LEAST,
  REPORT_BATCH_ITEM_FAILURES,
  VISIBILITY_TIMES_TIMEOUT,
} from '@flowatlas/aws';
import {
  makeChannelId,
  type DeployedDelivery,
  type DeployedFunction,
  type DeployedQueue,
  type DeployedSeconds,
  type Deployment,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { batchAnswerOf, type BatchAnswer, type HandlerCode } from './batch-answer.js';

/**
 * Where a deployment's settings contradict the code it runs (P389), for every
 * mapping from a queue to a function the repository's deployments declare:
 *
 * - the mapping says the function reports which messages failed and the
 *   handler never answers `batchItemFailures` (`batch-failures-unreported`),
 *   or the handler answers them and the mapping does not say so
 *   (`batch-failures-ignored`);
 * - the queue hides a message for less than six times the function's timeout
 *   plus the batch window (`queue-visibility-short`);
 * - the queue has no redrive policy (`queue-redrive-missing`), or one that
 *   hands a message on after fewer than five receives (`queue-receives-few`),
 *   said once per queue, on its declaration.
 *
 * A check is made only where every value it compares is a number the files
 * settle - written, or the format's default where nothing is written - and
 * the code it reads was read. Every check of a mapping not made is listed on
 * one `deployment-setting-unread` row with why, never left unsaid. A disabled
 * mapping delivers nothing and is not checked.
 */

/** One deployment of the repository, with what drawing it found. */
export interface SettingsReading {
  readonly deployment: Deployment;
  /** The code the function at a position runs, or why there is none to read. */
  readonly codeOf: (index: number) => HandlerCode | { readonly unread: string };
  /** The node drawn for a delivery, by its address. */
  readonly drawn: ReadonlyMap<string, string>;
}

const secondsOf = (value: DeployedSeconds | undefined): number | undefined => (value !== undefined && 'seconds' in value ? value.seconds : undefined);

const said = (value: DeployedSeconds | undefined, what: string): string =>
  value === undefined ? `${what} is not read` : 'unread' in value ? value.unread : `${what} is ${value.seconds}s${value.defaulted === true ? ' (the default)' : ''}`;

/** The function a mapping hands its batches to, where one the repository deploys is it. */
const functionOf = (
  delivery: DeployedDelivery,
  reading: SettingsReading,
  all: readonly SettingsReading[],
): { fn: DeployedFunction; index: number; reading: SettingsReading } | string => {
  const to = delivery.to;
  if (to === undefined || to.kind !== 'function') return 'the function it hands its batches to is not read';
  if ('function' in to) {
    const fn = reading.deployment.functions[to.function];
    return fn === undefined ? 'the function it hands its batches to is not read' : { fn, index: to.function, reading };
  }
  for (const other of all) {
    const index = other.deployment.functions.findIndex((fn) => fn.name === to.name);
    if (index >= 0) return { fn: other.deployment.functions[index] as DeployedFunction, index, reading: other };
  }
  return `the function ${to.name} is deployed somewhere this repository does not declare`;
};

/** Every queue the repository's deployments declare, by name. */
const queuesOf = (all: readonly SettingsReading[]): Map<string, DeployedQueue> => {
  const out = new Map<string, DeployedQueue>();
  for (const { deployment } of all) for (const queue of deployment.queues ?? []) if (!out.has(queue.name)) out.set(queue.name, queue);
  return out;
};

/** Every redrive from a queue, by the queue's name. */
const redrivesOf = (all: readonly SettingsReading[]): Map<string, DeployedDelivery[]> => {
  const out = new Map<string, DeployedDelivery[]>();
  for (const { deployment } of all) {
    for (const delivery of deployment.deliveries) {
      if (delivery.by !== 'redrive' || delivery.from.kind !== 'queue') continue;
      out.set(delivery.from.name, [...(out.get(delivery.from.name) ?? []), delivery]);
    }
  }
  return out;
};

const batchRows = (delivery: DeployedDelivery, who: string, answer: BatchAnswer, symbol: string, unmade: string[]): Unresolved[] => {
  const batch = delivery.batch;
  if (batch === undefined) {
    unmade.push(`whether ${delivery.address} reports the messages of a batch that failed is not read`);
    return [];
  }
  const reports = batch.reportsItemFailures;
  if (typeof reports !== 'boolean') {
    unmade.push(reports.unread);
    return [];
  }
  if (reports && answer.says === 'never') {
    return [
      {
        file: delivery.file,
        line: delivery.line,
        reason: 'batch-failures-unreported',
        message: `${delivery.address} says ${who} reports the messages of a batch that failed (${REPORT_BATCH_ITEM_FAILURES}), and its handler never returns batchItemFailures: every batch counts as a success, and a failed message is deleted`,
        hint: 'Return { batchItemFailures } from the handler, or use a batch helper that builds it.',
        symbol,
        meta: { function: who },
      },
    ];
  }
  if (!reports && answer.says === 'returns') {
    return [
      {
        file: delivery.file,
        line: delivery.line,
        reason: 'batch-failures-ignored',
        message: `${who} returns batchItemFailures (${answer.at}), and ${delivery.address} does not say it reports them (${REPORT_BATCH_ITEM_FAILURES}): the list is ignored, and a message it lists as failed is deleted with the rest`,
        hint: `Add ${REPORT_BATCH_ITEM_FAILURES} to the mapping's function response types.`,
        symbol,
        meta: { function: who, answeredAt: answer.at },
      },
    ];
  }
  if (reports && answer.says === 'unread') unmade.push(`whether ${who} returns batchItemFailures is not read: ${answer.why}`);
  return [];
};

const visibilityRows = (delivery: DeployedDelivery, who: string, fn: DeployedFunction, queue: DeployedQueue | undefined, symbol: string, unmade: string[]): Unresolved[] => {
  if (queue === undefined) return [];
  const visible = secondsOf(queue.visibilityTimeout);
  const timeout = secondsOf(fn.timeout);
  const window = delivery.batch?.window === undefined ? 0 : secondsOf(delivery.batch.window);
  if (visible === undefined || timeout === undefined || window === undefined) {
    unmade.push(
      [
        visible === undefined ? said(queue.visibilityTimeout, `the visibility timeout of ${queue.name}`) : undefined,
        timeout === undefined ? said(fn.timeout, `the timeout of ${who}`) : undefined,
        window === undefined ? said(delivery.batch?.window, `the batch window of ${delivery.address}`) : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join('; '),
    );
    return [];
  }
  const wanted = VISIBILITY_TIMES_TIMEOUT * timeout + window;
  if (visible >= wanted) return [];
  const under = visible < timeout;
  return [
    {
      file: delivery.file,
      line: delivery.line,
      reason: 'queue-visibility-short',
      message: `${queue.name} hides a message for ${visible}s${queue.visibilityTimeout !== undefined && 'defaulted' in queue.visibilityTimeout ? ' (the default)' : ''}, ${under ? `under the ${timeout}s timeout of ${who} itself, which the platform refuses when the mapping is created` : `under ${VISIBILITY_TIMES_TIMEOUT} times the ${timeout}s timeout of ${who}${window === 0 ? '' : ` plus the ${window}s batch window`} (${wanted}s)`}: a message can come back while it is still being processed, and be processed twice`,
      hint: `Raise the visibility timeout of ${queue.name} to at least ${wanted}s, or lower the function's timeout.`,
      symbol,
      meta: { queue: queue.name, visibilityTimeout: visible, functionTimeout: timeout, ...(window === 0 ? {} : { batchWindow: window }), wanted },
    },
  ];
};

/** The redrive checks of one queue a function reads: said once, on the queue. */
const redriveRows = (queue: DeployedQueue, redrives: readonly DeployedDelivery[]): { rows: Unresolved[]; unmade: string[] } => {
  const symbol = makeChannelId(queueChannel(queue.name));
  if (redrives.length === 0) {
    if (queue.redrive !== 'none') return { rows: [], unmade: [`whether ${queue.name} has a redrive policy is not read`] };
    return {
      rows: [
        {
          file: queue.file,
          line: queue.line,
          reason: 'queue-redrive-missing',
          message: `${queue.name} is read by a function and has no redrive policy: a message that always fails is received again and again until it expires, and is then lost`,
          hint: `Give ${queue.address} a dead-letter queue, with a maxReceiveCount of at least ${RECEIVES_AT_LEAST}.`,
          symbol,
          meta: { queue: queue.name },
        },
      ],
      unmade: [],
    };
  }
  const rows: Unresolved[] = [];
  const unmade: string[] = [];
  for (const redrive of redrives) {
    const receives = redrive.meta?.['maxReceiveCount'];
    if (typeof receives !== 'number') {
      unmade.push(`the maxReceiveCount of ${redrive.address} is not read`);
      continue;
    }
    if (receives >= RECEIVES_AT_LEAST) continue;
    rows.push({
      file: redrive.file,
      line: redrive.line,
      reason: 'queue-receives-few',
      message: `${redrive.address} hands a message of ${queue.name} to its dead-letter queue after ${receives} receive${receives === 1 ? '' : 's'}, under the ${RECEIVES_AT_LEAST} the platform recommends: a throttled or briefly failing function gets too few retries`,
      hint: `Set maxReceiveCount to at least ${RECEIVES_AT_LEAST}.`,
      symbol,
      meta: { queue: queue.name, maxReceiveCount: receives },
    });
  }
  return { rows, unmade };
};

export const deploymentSettingRows = (ctx: ExtractContext, readings: readonly SettingsReading[]): Unresolved[] => {
  const queues = queuesOf(readings);
  const redrives = redrivesOf(readings);
  const rows: Unresolved[] = [];
  const checkedQueues = new Set<string>();
  for (const reading of readings) {
    for (const delivery of reading.deployment.deliveries) {
      if (delivery.by !== 'mapping' || delivery.from.kind !== 'queue' || delivery.meta?.['disabled'] === true) continue;
      const symbol = reading.drawn.get(delivery.address) ?? delivery.address;
      const unmade: string[] = [];
      const queue = queues.get(delivery.from.name);
      if (queue === undefined) unmade.push(`the queue ${delivery.from.name} is declared somewhere this repository's deployment does not hold, so its visibility timeout and redrive policy are not read`);
      else if (!checkedQueues.has(queue.name)) {
        checkedQueues.add(queue.name);
        const redrive = redriveRows(queue, redrives.get(queue.name) ?? []);
        rows.push(...redrive.rows);
        unmade.push(...redrive.unmade);
      }
      const target = functionOf(delivery, reading, readings);
      if (typeof target === 'string') {
        unmade.push(`${target}, so its timeout and handler are not compared`);
      } else {
        const who = target.fn.name ?? target.fn.address;
        rows.push(...visibilityRows(delivery, who, target.fn, queue, symbol, unmade));
        const code = target.reading.codeOf(target.index);
        const answer: BatchAnswer = 'unread' in code ? { says: 'unread', why: code.unread } : batchAnswerOf(code, ctx);
        rows.push(...batchRows(delivery, who, answer, symbol, unmade));
      }
      if (unmade.length > 0) {
        rows.push({
          file: delivery.file,
          line: delivery.line,
          reason: 'deployment-setting-unread',
          level: 'info',
          message: `${delivery.address}: not every setting it is held to is checked: ${unmade.join('; ')}`,
          hint: 'Nothing is said about these either way. Write the values so the files settle them, or declare the queue and the function in a deployment of this repository.',
          symbol,
          meta: { unmade },
        });
      }
    }
  }
  return rows;
};
