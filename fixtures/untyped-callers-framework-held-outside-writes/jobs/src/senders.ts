import { Queue } from 'bullmq';

/** A sender whose queue is laid over it from outside, once it is made. */
export class Mailer {
  queue?: Queue;

  send(to: string) {
    return this.queue.add('send', { to });
  }
}

export const mailer = new Mailer();
Object.assign(mailer, { queue: new Queue('outbox', { connection: {} }) });

/** A sender whose queue is written on it from outside, plainly. */
export class Notifier {
  queue?: Queue;

  notify(user: string) {
    return this.queue.add('notify', { user });
  }
}

export const notifier = new Notifier();
notifier.queue = new Queue('notices', { connection: {} });

/** A sender taking its queue in its options, laid over it whole, which a class extending it hands on. */
export class Pusher {
  queue!: Queue;

  constructor(options: { queue: Queue }) {
    Object.assign(this, options);
  }

  push(item: string) {
    return this.queue.add('push', { item });
  }
}

export class UrgentPusher extends Pusher {
  constructor(options: { queue: Queue }) {
    super(options);
  }
}

export const urgent = new UrgentPusher({ queue: new Queue('urgent', { connection: {} }) });
