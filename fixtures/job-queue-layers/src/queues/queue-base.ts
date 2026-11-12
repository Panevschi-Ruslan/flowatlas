import { Job, Processor } from 'bullmq';
import { BullService } from './bull.service.js';

export enum Topic {
  Mail = 'mail',
  Invoices = 'invoices',
}

export interface QueuedJob {
  name: string;
  data: unknown;
}

/** Every queue of the shop is one of these, its topic handed in by the class extending it. */
export class QueueBase {
  private bull: BullService;

  constructor(
    public readonly topic: Topic,
    bull: BullService,
  ) {
    this.bull = bull;
  }

  open(): void {
    this.bull.openQueue(this.topic);
  }

  async add(job: QueuedJob): Promise<void> {
    await this.addToBull(job);
  }

  private async addToBull(job: QueuedJob): Promise<void> {
    await this.bull.add(job.name, job.data);
  }
}

export class MailQueue extends QueueBase {
  constructor() {
    super(Topic.Mail, new BullService());
    this.open();
  }
}

export class InvoiceQueue extends QueueBase {
  constructor(bull: BullService) {
    super(Topic.Invoices, bull);
    this.open();
  }
}

/** Every worker likewise. */
export class WorkerBase {
  constructor(
    public readonly topic: Topic,
    private readonly bull: BullService,
  ) {}

  start(processor: Processor): void {
    this.bull.openWorker(this.topic, processor);
  }
}

export class MailWorker extends WorkerBase {
  constructor(bull: BullService) {
    super(Topic.Mail, bull);
  }
}

export class InvoiceWorker extends WorkerBase {
  constructor(bull: BullService) {
    super(Topic.Invoices, bull);
  }
}

export const startWorkers = (): void => {
  new MailWorker(new BullService()).start(async (job: Job<{ email: string }>) => {
    console.log('mail to', job.data.email);
  });
  new InvoiceWorker(new BullService()).start(async (job: Job<{ orderId: string }>) => {
    console.log('invoice for', job.data.orderId);
  });
};
