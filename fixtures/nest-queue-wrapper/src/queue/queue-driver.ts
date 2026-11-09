import type { QueueName } from './queue-name';

export interface ScheduledJob<T> {
  queueName: QueueName;
  jobName: string;
  data: T;
  pattern: string;
}

/** What runs a queue's jobs: the broker, or nothing but the process itself. */
export interface QueueDriver {
  add<T>(queueName: QueueName, jobName: string, data: T): Promise<void>;
  addCron<T>(job: ScheduledJob<T>): Promise<void>;
}
