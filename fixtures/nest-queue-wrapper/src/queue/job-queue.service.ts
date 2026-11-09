import { Inject } from '@nestjs/common';

import type { QueueDriver } from './queue-driver';
import type { QueueName } from './queue-name';
import { QUEUE_DRIVER } from './queue-token';

/**
 * One queue of the shop. The container builds one per queue, each with its
 * queue's name (`queue.module.ts`), and a caller asks for the one it wants by
 * name (`@InjectJobQueue(QueueName.mail)`).
 */
export class JobQueueService {
  constructor(
    @Inject(QUEUE_DRIVER) private readonly driver: QueueDriver,
    private readonly queueName: QueueName,
  ) {}

  add<T>(jobName: string, data: T): Promise<void> {
    return this.driver.add(this.queueName, jobName, data);
  }

  addCron<T>({ jobName, data, pattern }: { jobName: string; data: T; pattern: string }): Promise<void> {
    return this.driver.addCron({ queueName: this.queueName, jobName, data, pattern });
  }
}
