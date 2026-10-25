import type { Order } from '../lib/clients';

/** Invoked by the fulfilment workflow's `ChargeCard` step, by its ARN. */
export const handler = async (order: Order): Promise<{ charged: boolean; orderId: string }> => ({
  charged: order.items.length > 0,
  orderId: order.orderId,
});
