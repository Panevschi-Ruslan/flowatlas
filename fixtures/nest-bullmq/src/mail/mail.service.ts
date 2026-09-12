import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';

import type { ReportJob, SendDigestJob, SendEmailJob } from './jobs';

/**
 * Producers. For BullMQ the channel is the queue, not the job name: every call
 * below lands on `channel:mail` with `meta.channelKind: "queue"`, and the job
 * name is `producer.meta.jobName`.
 */
@Injectable()
export class MailService {
  constructor(
    // The queue name comes from the injection token, which is the only place it
    // is written down — `Queue` itself carries no name in its type.
    @InjectQueue('mail') private readonly mail: Queue<SendEmailJob>,
    @InjectQueue('digest') private readonly digest: Queue<SendDigestJob>,
  ) {}

  // The canonical row: literal job name, queue from `@InjectQueue('mail')`.
  // Expected: `channel:mail`, `meta.kind: "job"`, `meta.jobName: "send-email"`,
  // static.
  sendWelcome(job: SendEmailJob): Promise<Job<SendEmailJob>> {
    return this.mail.add('send-email', job, { attempts: 3 });
  }

  // A second job name on the same queue: still one `channel:mail` node.
  // Expected: `meta.jobName: "send-digest"`, static.
  sendDigest(job: SendDigestJob): Promise<Job<SendDigestJob>> {
    return this.digest.add('send-digest', job);
  }

  // A dynamic job name. The channel is still resolved from the queue token, so
  // this stays `static`; only `meta.jobName` is null (§10).
  enqueue(jobName: string, job: SendEmailJob): Promise<Job<SendEmailJob>> {
    return this.mail.add(jobName, job);
  }

  // The queue is constructed with a name only known at run time, so there is no
  // token to read and no queue name to use as the channel.
  // Expected: `producer` with no channel, unresolved `channel-dynamic`.
  enqueueReport(queueName: string, job: ReportJob): Promise<Job<ReportJob>> {
    const queue = new Queue<ReportJob>(queueName);
    return queue.add('build-report', job);
  }
}
