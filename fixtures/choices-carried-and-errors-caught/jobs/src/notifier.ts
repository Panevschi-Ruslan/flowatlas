import axios from 'axios';
import { Queue } from 'bullmq';

/** Raised by the shop's own checks, naming the job to run instead. */
export class Deferred extends Error {
  constructor(public readonly jobName: string) {
    super(`deferred to ${jobName}`);
  }
}

/**
 * Notifications go to a push service first; whatever it refuses is queued.
 * The job queued after a refusal is named by the error caught: the shop's
 * own `Deferred` names one, and an error the push client throws carries one
 * in the push service's answer, which nothing here writes.
 */
export class Notifier {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue('notifications', { connection: {} });
  }

  private check(kind: string): void {
    if (kind === 'sms') throw new Deferred('notify-later');
  }

  async notify(kind: string, data: unknown): Promise<void> {
    try {
      this.check(kind);
      await axios.post('https://push.example/notify', { kind, data });
    } catch (error) {
      await this.enqueue(error.jobName, data);
    }
  }

  async pushed(data: unknown): Promise<void> {
    try {
      await axios.post('https://push.example/notify', { data });
    } catch (error) {
      await this.enqueue(error.response.data.retryJob, data);
    }
  }

  /** A refusal re-uses only what the try block was handed: followed as ever. */
  async remind(kind: string, data: unknown): Promise<void> {
    try {
      await axios.post('https://push.example/remind', { kind, data });
    } catch {
      await this.enqueue(kind, data);
    }
  }

  private async enqueue(name: string, data: unknown): Promise<void> {
    await this.queue.add(name, data);
  }
}
