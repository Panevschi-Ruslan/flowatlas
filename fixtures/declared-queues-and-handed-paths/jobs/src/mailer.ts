import { Queue } from 'bullmq';

/** A queue kept in a field set where it is declared. */
export class Mailer {
  private readonly queue = new Queue('emails', { connection: {} });

  async welcome(to: string): Promise<void> {
    await this.enqueue('welcome', { to });
  }

  async reset(to: string): Promise<void> {
    await this.enqueue('password-reset', { to });
  }

  private async enqueue(name: string, data: unknown): Promise<void> {
    await this.queue.add(name, data);
  }
}

/** The same field without modifiers. */
export class Invoicer {
  queue = new Queue('invoices', { connection: {} });

  async issue(id: string): Promise<void> {
    await this.queue.add('issue', { id });
  }
}

/** A static field, read through the class. */
export class Reporter {
  static readonly queue = new Queue('reports', { connection: {} });

  static async daily(): Promise<void> {
    await Reporter.queue.add('daily', {});
  }

  async weekly(): Promise<void> {
    await Reporter.queue.add('weekly', {});
  }
}
