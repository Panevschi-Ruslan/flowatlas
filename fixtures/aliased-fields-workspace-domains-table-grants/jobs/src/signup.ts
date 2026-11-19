import { Registry } from './registry';

/** A new customer is charged through the billing queue `setup.ts` opens. */
export async function charge(customer: string): Promise<void> {
  await Registry.billing.add('charge', { customer });
}

/** The mail queue is one of two the code may open: which one is not read. */
export async function welcome(to: string): Promise<void> {
  await Registry.mail.add('welcome', { to });
}
