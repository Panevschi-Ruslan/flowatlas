import { dataSource } from '../data-source.js';
import { InvoiceEntity, Order } from './entities.js';

/**
 * The data layer as a module of exported functions.
 *
 * Four queries, written the four ways a function gets written: a declared function, an
 * arrow assigned to a const, a query one body further in than the function that holds
 * it, and a second entity so the pair of spellings is covered. `orders.class.ts` is the
 * same four as a class, and the two must read the same.
 */
const orders = dataSource.getRepository<Order>(Order);
const invoices = dataSource.getRepository<InvoiceEntity>(InvoiceEntity);

/** A declared function at the top of a module. */
export async function listOrders(): Promise<Order[]> {
  return orders.find();
}

/** The same thing written as an arrow assigned to a const. */
export const saveOrder = async (order: Order): Promise<Order> => orders.save(order);

/**
 * A query written inside a function inside a function.
 *
 * Nothing names the inner one, so the query belongs to the exported function around it,
 * exactly as a query inside a callback in a method belongs to the method.
 */
export async function archiveOrder(id: string): Promise<void> {
  const purge = async (): Promise<void> => {
    await orders.delete(id);
  };
  await purge();
}

/** A write whose entity name carries a wrapper suffix, so both spellings are here. */
export const saveInvoice = async (invoice: InvoiceEntity): Promise<InvoiceEntity> =>
  invoices.save(invoice);
