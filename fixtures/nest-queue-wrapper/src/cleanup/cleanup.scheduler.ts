import { Injectable, type OnModuleInit } from '@nestjs/common';

import { InjectJobQueue } from '../queue/inject-job-queue.decorator';
import { JobQueueService } from '../queue/job-queue.service';
import { QueueName } from '../queue/queue-name';
import { CleanupCronJob } from './cleanup.cron.job';

/** Registers a repeated job: a producer of that job on the cron queue. */
@Injectable()
export class CleanupScheduler implements OnModuleInit {
  constructor(@InjectJobQueue(QueueName.cron) private readonly cronQueue: JobQueueService) {}

  onModuleInit(): Promise<void> {
    return this.cronQueue.addCron({ jobName: CleanupCronJob.name, data: undefined, pattern: '0 * * * *' });
  }
}
