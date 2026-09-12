import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import type { SendDigestJob, SendEmailJob } from './jobs';

/**
 * The bullmq-era consumer: one class per queue, one `process` method for every
 * job name on it. Expected: exactly one `consumer` node, on `process`, with
 * `meta.queue: "mail"` and `meta.jobNames: ["send-email", "send-digest"]` read
 * from the literal `case` labels of the switch (§10).
 *
 * `meta.entryId` is null: `@Processor` is not a P01 entry decorator.
 */
@Processor('mail')
export class MailProcessor extends WorkerHost {
  async process(job: Job<SendEmailJob | SendDigestJob>): Promise<void> {
    switch (job.name) {
      case 'send-email':
        await this.send(job.data as SendEmailJob);
        break;
      case 'send-digest':
        await this.digest(job.data as SendDigestJob);
        break;
      default:
        break;
    }
  }

  private async send(data: SendEmailJob): Promise<void> {
    void data.to;
  }

  private async digest(data: SendDigestJob): Promise<void> {
    void data.since;
  }
}
