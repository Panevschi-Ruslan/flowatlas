import { Injectable } from '@nestjs/common';

import { BullMqDriver } from '../queue/bullmq.driver';
import { InjectJobQueue } from '../queue/inject-job-queue.decorator';
import { JobQueueService } from '../queue/job-queue.service';
import { QueueName } from '../queue/queue-name';
import { SendMailJob, type SendMailData } from './send-mail.job';

@Injectable()
export class WelcomeService {
  /** A queue's service built here rather than asked for: its queue is the one it is built with. */
  private readonly digestQueue = new JobQueueService(new BullMqDriver(), QueueName.mail);

  constructor(@InjectJobQueue(QueueName.mail) private readonly mailQueue: JobQueueService) {}

  welcome(to: string): Promise<void> {
    return this.mailQueue.add<SendMailData>(SendMailJob.name, { to, template: 'welcome' });
  }

  /** The queue is known here and the job is not: its name is whatever the caller hands in. */
  resend(jobName: string, to: string): Promise<void> {
    return this.mailQueue.add(jobName, { to, template: 'resend' });
  }

  digest(to: string): Promise<void> {
    return this.digestQueue.add<SendMailData>(SendMailJob.name, { to, template: 'digest' });
  }
}
