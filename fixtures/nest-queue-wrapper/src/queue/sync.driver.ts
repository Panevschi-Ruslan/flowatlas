import type { QueueDriver, ScheduledJob } from './queue-driver';
import type { QueueName } from './queue-name';

/** Runs nothing: the driver tests and a single process use. */
export class SyncDriver implements QueueDriver {
  readonly added: Array<{ queueName: QueueName; jobName: string }> = [];

  async add<T>(queueName: QueueName, jobName: string, _data: T): Promise<void> {
    this.added.push({ queueName, jobName });
  }

  async addCron<T>(job: ScheduledJob<T>): Promise<void> {
    this.added.push({ queueName: job.queueName, jobName: job.jobName });
  }
}
