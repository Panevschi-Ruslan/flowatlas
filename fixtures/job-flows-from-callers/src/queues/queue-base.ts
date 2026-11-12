import { BullClient, QueuedJob } from './bull-client.js';

export enum Topic {
  Mail = 'mail',
  Invoices = 'invoices',
  Receipts = 'receipts',
}

/** Sends jobs to the shop's relay when it is switched on. */
class Relay {
  enabled = process.env.JOB_RELAY !== undefined;

  async send(topic: string, jobs: QueuedJob[]): Promise<void> {
    if (!this.enabled) throw new Error(`no relay for ${topic} (${jobs.length} jobs)`);
  }
}

/**
 * Every queue of the shop is one of these, its topic handed in by the class
 * extending it. A job goes to the relay when it is on, and falls back to the
 * queue when the relay refuses it: the queue's own add is reached through
 * five calls of the layer before the caller's.
 */
export class QueueBase {
  private relay = new Relay();

  constructor(
    public readonly topic: Topic,
    private readonly bull: BullClient,
  ) {}

  open(): void {
    this.bull.openQueue(this.topic);
  }

  async add(job: QueuedJob): Promise<void> {
    if (!this.relay.enabled) return this.addToBull(job);
    return this.dispatch([job]);
  }

  private async dispatch(jobs: QueuedJob[]): Promise<void> {
    try {
      await this.relay.send(this.topic, jobs);
    } catch (error) {
      await this.fallBack(error, jobs);
    }
  }

  private async fallBack(error: unknown, jobs: QueuedJob[]): Promise<void> {
    console.warn('relay refused, falling back to the queue', error);
    await this.addAllToBull(jobs);
  }

  private async addAllToBull(jobs: QueuedJob[]): Promise<void> {
    if (jobs.length === 1) return this.addToBull(jobs[0]);
    await this.bull.addBulk(jobs);
  }

  private async addToBull(job: QueuedJob): Promise<void> {
    await this.bull.add(job.name, job.data);
  }
}

export class MailQueue extends QueueBase {
  constructor(bull: BullClient) {
    super(Topic.Mail, bull);
    this.open();
  }
}

export class InvoiceQueue extends QueueBase {
  constructor(bull: BullClient) {
    super(Topic.Invoices, bull);
    this.open();
  }
}
