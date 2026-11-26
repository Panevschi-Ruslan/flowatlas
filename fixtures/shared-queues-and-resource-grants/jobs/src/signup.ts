import { Queues } from './queues';

/** A new customer is welcomed through the shared mail queue. */
export async function welcome(to: string): Promise<void> {
  await Queues.mail.add('welcome', { to });
}

/** The audit queue is one of two the code opens: which runs last is not read. */
export async function record(entry: string): Promise<void> {
  await Queues.audit.add('entry', { entry });
}
