import { Queue } from 'bullmq';

import type { QueueDriver, ScheduledJob } from './queue-driver';
import type { QueueName } from './queue-name';

/**
 * The broker. One client per queue, kept by the queue's name, and the only
 * place in the shop the broker is called: every enqueue below is the shop's
 * `JobQueueService` handing its queue and its caller's job down to here.
 */
export class BullMqDriver implements QueueDriver {
  private readonly queues: Partial<Record<QueueName, Queue>> = {};

  register(queueName: QueueName): void {
    this.queues[queueName] = new Queue(queueName, { connection: { host: 'localhost', port: 6379 } });
  }

  async add<T>(queueName: QueueName, jobName: string, data: T): Promise<void> {
    await this.queues[queueName].add(jobName, data);
  }

  async addCron<T>({ queueName, jobName, data, pattern }: ScheduledJob<T>): Promise<void> {
    await this.queues[queueName].upsertJobScheduler(jobName, { pattern }, { name: jobName, data });
  }
}
