import { integer, pgTable, text } from 'drizzle-orm';

/**
 * The schema objects are where the table names live. Nothing in the type of the
 * connection carries them, so `db.insert(orders)` is only readable because
 * `orders` can be followed back to the `pgTable('orders', …)` it was declared as.
 */
export const orders = pgTable('orders', {
  id: text('id'),
  userId: text('user_id'),
  total: integer('total'),
});

export const invoices = pgTable('invoices', {
  id: text('id'),
  orderId: text('order_id'),
});
