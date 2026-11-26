import { Queue } from 'bullmq';

/** The shop's shared queues, opened once here. */
export class Registry {
  static mail: Queue = new Queue('mail', { connection: {} });
  static billing: Queue = new Queue('billing', { connection: {} });
}
