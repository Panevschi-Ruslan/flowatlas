import { Queue } from 'bullmq';
import { Queues } from './registry';

/** Opens the live queues, laid over the registry in one call. */
export const setup = (): void => {
  Object.assign(Queues, {
    mail: new Queue('mail', { connection: {} }),
    audit: new Queue('audit', { connection: {} }),
  });
};
