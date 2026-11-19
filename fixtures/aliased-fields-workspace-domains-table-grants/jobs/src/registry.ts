import { Queue } from 'bullmq';

/** The shop's shared queues: `mail` opened here, `billing` by `setup.ts`. */
export class Registry {
  static mail: Queue = new Queue('mail', { connection: {} });
  static billing: Queue;
}
