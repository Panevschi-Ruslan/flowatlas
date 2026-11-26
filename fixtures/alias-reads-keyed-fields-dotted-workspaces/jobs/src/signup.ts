import { Registry } from './registry';

// The registry under `any`, as code that picks queues by name might hold it.
const queues: any = Registry;

/** A new customer is welcomed through the mail queue, read through the alias. */
export async function welcome(to: string): Promise<void> {
  await queues.mail.add('welcome', { to });
}

const BILLING = 'billing';

/** A new customer is charged through the billing queue, read by a key a constant holds. */
export async function charge(customer: string): Promise<void> {
  await Registry[BILLING].add('charge', { customer });
}

/** Sends a reminder on whatever queue registry it is handed: each caller hands the registry. */
const remind = (target: any, to: string) => target.mail.add('reminder', { to });

export async function remindAll(to: string): Promise<void> {
  await remind(Registry, to);
}
