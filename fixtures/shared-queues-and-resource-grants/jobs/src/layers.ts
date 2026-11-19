import { Queue } from 'bullmq';

/** A layer that declares its queue where it declares the field. */
abstract class ReportLayer {
  protected readonly queue = new Queue('reports', { connection: {} });
}

export class DailyReports extends ReportLayer {
  async run(): Promise<void> {
    await this.queue.add('daily-summary', {});
  }
}

/** A layer that keeps the queue each class extending it hands its constructor. */
abstract class QueueLayer {
  constructor(protected readonly queue: Queue) {}
}

export class Exports extends QueueLayer {
  constructor() {
    super(new Queue('exports', { connection: {} }));
  }

  async csv(): Promise<void> {
    await this.queue.add('export-csv', {});
  }
}

/** A layer that sets its queue in its own constructor. */
abstract class InvoiceLayer {
  protected queue: Queue;

  constructor() {
    this.queue = new Queue('invoices', { connection: {} });
  }
}

export class Invoices extends InvoiceLayer {
  async issue(id: string): Promise<void> {
    await this.queue.add('issue', { id });
  }
}
