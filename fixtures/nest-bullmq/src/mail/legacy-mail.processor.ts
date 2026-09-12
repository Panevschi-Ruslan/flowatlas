import { Process, Processor } from '@nestjs/bull';
import type { Job } from '@nestjs/bull';

import type { SendEmailJob } from './jobs';

/**
 * The bull-era consumer, which the same `bullmq` adapter covers (§7): one
 * `consumer` per `@Process` method rather than one per class.
 *
 * Expected: two consumers, both `meta.queue: "mail"`, with
 * `meta.jobName: "send-email"` and `meta.jobName: null`.
 */
@Processor('mail')
export class LegacyMailProcessor {
  @Process('send-email')
  async handleSendEmail(job: Job<SendEmailJob>): Promise<void> {
    void job.data.template;
  }

  // A decorator with no arguments: bull treats this as the queue's default
  // handler. Expected: `meta.jobName: null`, and above all no crash (§10).
  @Process()
  async handleAny(job: Job<SendEmailJob>): Promise<void> {
    void job.name;
  }
}
