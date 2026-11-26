import { Queue } from 'bullmq';
import { Registry } from './registry';

// The registry under `any`, as code that fills it from a list of names might hold it.
const registry: any = Registry;

/** Opens the billing queue, once, through the alias. */
export function setup(): void {
  registry.billing = new Queue('billing', { connection: {} });
}

/** Swaps the mail queue for a priority one where the shop asks for it. */
const prioritise = (target: any): void => {
  target.mail = new Queue('mail-priority', { connection: {} });
};

export function usePriorityMail(): void {
  prioritise(Registry);
}
