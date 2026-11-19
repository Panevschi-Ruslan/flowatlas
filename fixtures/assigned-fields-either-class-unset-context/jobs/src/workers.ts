import { Queue } from 'bullmq';
import { Archive, Queues } from './registry';

/** A sender that takes its queue in its options, laid over it whole. */
export class Mailer {
  queue!: Queue;

  constructor(options: { queue: Queue }) {
    Object.assign(this, options);
  }

  send(to: string) {
    return this.queue.add('send', { to });
  }
}

export const mailer = new Mailer({ queue: new Queue('outbox', { connection: {} }) });

/** A loader whose settings come from text read at run time, which may name any field. */
export class Loader {
  queue = new Queue('imports', { connection: {} });

  load(raw: string): void {
    Object.assign(this, JSON.parse(raw));
  }

  flush() {
    return this.queue.add('flush', {});
  }
}

/** Audits through the live registry. */
export async function audit(entry: string): Promise<void> {
  await Queues.audit.add('entry', { entry });
}

/** Delivers on whichever registry it is handed: the live one or the archive, each declaring its own mail queue. */
const deliver = (target: any, to: string) => target.mail.add('deliver', { to });

export async function deliverLive(to: string): Promise<void> {
  await deliver(Queues, to);
}

export async function deliverArchived(to: string): Promise<void> {
  await deliver(Archive, to);
}
