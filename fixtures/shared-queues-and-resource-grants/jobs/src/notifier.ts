import { Queue } from 'bullmq';
import { makePushClient } from './push';

/** Raised by the shop's own checks, naming the job to run instead. */
export class Deferred extends Error {
  constructor(public readonly jobName: string) {
    super(`deferred to ${jobName}`);
  }
}

const push = makePushClient();

/**
 * A notice goes to the push service first; a refusal queues the job the
 * caught error names, right at the queue's own call.
 */
export class Notifier {
  private readonly queue = new Queue('notices', { connection: {} });

  private check(to: string): void {
    if (to === '') throw new Deferred('notice-later');
  }

  async notify(to: string, body: string): Promise<void> {
    try {
      this.check(to);
      await push.send({ to, body });
    } catch (error) {
      await this.queue.add(error.jobName, { to, body });
    }
  }
}
