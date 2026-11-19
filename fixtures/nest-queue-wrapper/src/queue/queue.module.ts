import { Global, Module, type Provider } from '@nestjs/common';

import { BullMqDriver } from './bullmq.driver';
import { JobQueueService } from './job-queue.service';
import type { QueueDriver } from './queue-driver';
import { QueueName } from './queue-name';
import { QUEUE_DRIVER, queueToken } from './queue-token';
import { SyncDriver } from './sync.driver';

const driverProvider: Provider = {
  provide: QUEUE_DRIVER,
  useFactory: (): QueueDriver => {
    if (process.env.QUEUE_DRIVER === 'sync') return new SyncDriver();
    const driver = new BullMqDriver();
    for (const name of Object.values(QueueName)) driver.register(name);
    return driver;
  },
};

/** One service per queue, under the token made from the queue's name, built with that name. */
const queueProviders: Provider[] = Object.values(QueueName).map((name) => ({
  provide: queueToken(name),
  useFactory: (driver: QueueDriver) => new JobQueueService(driver, name),
  inject: [QUEUE_DRIVER],
}));

@Global()
@Module({
  providers: [driverProvider, ...queueProviders],
  exports: Object.values(QueueName).map((name) => queueToken(name)),
})
export class QueueModule {}
