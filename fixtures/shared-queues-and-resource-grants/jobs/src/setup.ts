import { Queue } from 'bullmq';
import { Queues } from './queues';

/** Opens the shared queues: `mail` once, `audit` under a name each environment picks. */
export function setup(): void {
  Queues.mail = new Queue('mail', { connection: {} });
  Queues.audit = new Queue('audit', { connection: {} });
}

export function useArchive(): void {
  Queues.audit = new Queue('audit-archive', { connection: {} });
}
