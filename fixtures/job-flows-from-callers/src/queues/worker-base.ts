import { Job, Processor } from 'bullmq';
import { BullClient } from './bull-client.js';
import { Topic } from './queue-base.js';

/**
 * Every worker of the shop is one of these: its topic handed in by the class
 * extending it, its processor by whoever starts it.
 */
export class WorkerBase {
  constructor(
    public readonly topic: Topic,
    private readonly bull: BullClient,
  ) {}

  init(processor: Processor): void {
    this.startWorker(processor);
  }

  private startWorker(processor: Processor): void {
    this.bull.openWorker(this.topic, processor);
  }
}

/** The shared library's mail worker, its processor left to the application. */
export class MailWorkerBase extends WorkerBase {
  constructor(bull: BullClient) {
    super(Topic.Mail, bull);
  }
}

/** The application's mail worker, which starts itself with the processor it makes. */
export class MailWorker extends MailWorkerBase {
  constructor(bull: BullClient) {
    super(bull);
    this.init(this.processor());
  }

  private processor(): Processor {
    return async (job: Job<{ email: string }>) => {
      console.log('mail to', job.data.email);
    };
  }
}

/** A worker that starts itself with one of its own methods. */
export class ReceiptWorker extends WorkerBase {
  constructor(bull: BullClient) {
    super(Topic.Receipts, bull);
    this.init(this.print.bind(this));
  }

  async print(job: Job<{ orderId: string }>): Promise<void> {
    console.log('receipt for', job.data.orderId);
  }
}

/** A worker started from outside with a function. */
export class InvoiceWorker extends WorkerBase {
  constructor(bull: BullClient) {
    super(Topic.Invoices, bull);
  }
}

export async function issueInvoice(job: Job<{ orderId: string }>): Promise<void> {
  console.log('invoice for', job.data.orderId);
}

export const startWorkers = (): void => {
  new MailWorker(new BullClient());
  new ReceiptWorker(new BullClient());
  new InvoiceWorker(new BullClient()).init(issueInvoice);
};
