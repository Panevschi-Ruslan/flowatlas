import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';

type MailData = { to: string; template: string };

/** Every handler of the mail queue names the one job it takes. */
@Processor('mail-queue')
export class MailProcessor {
  @Process('send-welcome')
  async welcome(job: Job<MailData>): Promise<void> {
    void job.data.to;
  }

  @Process('send-receipt')
  async receipt(job: Job<MailData>): Promise<void> {
    void job.data.to;
  }
}
