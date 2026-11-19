import { Queue } from 'bullmq';

/** The shop's live queues, opened by `setup.ts` at start. */
export class Queues {
  static mail: Queue;
  static audit: Queue;
}

/** The queues of the archive, opened here. */
export class Archive {
  static mail: Queue = new Queue('archive-mail', { connection: {} });
}
