import { Queue } from 'bullmq';

/** Notices go out on the queue the class declares - unless `escalate` opens another, written by its key. */
export class Notifier {
  protected queue = new Queue('notices', { connection: {} });

  escalate(): void {
    this['queue'] = new Queue('urgent-notices', { connection: {} });
  }

  async notify(id: string): Promise<void> {
    await this.queue.add('notice', { id });
  }
}

const QUEUE = 'queue';

/** Digests go out on the one queue the constructor opens, under a key a constant holds. */
export class Digests {
  protected queue: Queue;

  constructor() {
    this[QUEUE] = new Queue('digests', { connection: {} });
  }

  async send(): Promise<void> {
    await this.queue.add('digest', {});
  }
}

/** Settings may be overwritten by any key at all, so which queue `flush` adds to is not read. */
export class Settings {
  protected queue = new Queue('settings', { connection: {} });

  apply(key: string, value: unknown): void {
    (this as any)[key] = value;
  }

  async flush(): Promise<void> {
    await this.queue.add('flush', {});
  }
}
