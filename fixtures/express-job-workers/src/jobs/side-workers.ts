import { Job, Worker } from 'bullmq';
import { sendReceipt } from './handlers.js';

/** A worker written plainly, its processor in place. */
export const auditWorker = new Worker('audit-queue', async (job: Job<{ action: string }>) => {
  console.log('audit', job.data.action);
});

/** One worker per name of a list written out, all running one handler. */
const MAIL_QUEUES = ['mail-low', 'mail-high'] as const;

export const startMailWorkers = (): Worker[] => MAIL_QUEUES.map((name) => new Worker(name, sendReceipt));

/** Queues named in settings: nothing here says which they are. */
declare const queuesFromSettings: string[];

export function startConfiguredWorkers(): void {
  for (const name of queuesFromSettings) new Worker(name, sendReceipt);
}
