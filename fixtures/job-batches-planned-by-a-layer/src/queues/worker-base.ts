import { Job, Processor } from 'bullmq';
import { BullClient } from './bull-client.js';
import { Topic } from './queue-base.js';

/** Every worker of the shop is one of these: its topic handed in by the class extending it, its processor by the class too. */
export class WorkerBase {
  constructor(
    public readonly topic: Topic,
    private readonly bull: BullClient,
  ) {}

  protected init(processor: Processor): void {
    this.bull.openWorker(this.topic, processor);
  }
}

/** A worker whose processor is written where it starts, and does more than hand the job on. */
export class MailWorker extends WorkerBase {
  constructor(bull: BullClient) {
    super(Topic.Mail, bull);
    this.init(async (job: Job<{ email: string }>) => {
      if (!job.data.email.includes('@')) return;
      await deliverMail(job.data.email, job.name);
      await recordDelivery(job.id);
    });
  }
}

/** A worker whose processor written where it starts only hands the job to a method. */
export class InvoiceWorker extends WorkerBase {
  constructor(bull: BullClient) {
    super(Topic.Invoices, bull);
    this.init((job) => this.issue(job));
  }

  async issue(job: Job<{ orderId: string }>): Promise<void> {
    console.log('invoice for', job.data.orderId);
  }
}

export async function deliverMail(email: string, template: string): Promise<void> {
  console.log('mail', template, 'to', email);
}

export async function recordDelivery(id: string | undefined): Promise<void> {
  console.log('delivered', id);
}
