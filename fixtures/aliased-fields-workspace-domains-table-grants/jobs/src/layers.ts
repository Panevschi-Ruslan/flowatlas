import { Queue } from 'bullmq';

/** Notices go out on the queue the class declares - unless a class extending it opens another. */
export class Notifier {
  protected queue = new Queue('notices', { connection: {} });

  async notify(id: string): Promise<void> {
    await this.queue.add('notice', { id });
  }
}

/** Runs `notify` on a queue of its own, so which queue `notify` adds to is not read. */
export class UrgentNotifier extends Notifier {
  open(): void {
    this.queue = new Queue('urgent-notices', { connection: {} });
  }
}

/** Reports go out on the queue the class declares. */
export class Reports {
  protected queue = new Queue('reports', { connection: {} });

  async run(): Promise<void> {
    await this.queue.add('report', {});
  }
}

/**
 * Opens a queue of its own and runs its own `run`, never the one above: what
 * it sets is not what `Reports.run` reads.
 */
export class WeeklyReports extends Reports {
  constructor() {
    super();
    this.queue = new Queue('weekly-reports', { connection: {} });
  }

  async run(): Promise<void> {
    await this.queue.add('weekly', {});
  }
}
