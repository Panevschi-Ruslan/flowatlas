import { Queue } from 'bullmq';

/** The shop's shared queues, opened once by `setup.ts`. */
export class Queues {
  static mail: Queue;
  static audit: Queue;
}
