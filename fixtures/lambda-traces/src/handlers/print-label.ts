import type { Order } from '../lib/clients';

/** Invoked by `ship-order`, and answers with the label it printed. */
export const handler = async (order: Order): Promise<{ label: string }> => ({ label: `${order.orderId}: ${order.items.length} item(s)` });
