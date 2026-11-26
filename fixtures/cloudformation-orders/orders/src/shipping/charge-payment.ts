import type { Order } from '../lib/orders';

/** The shipping workflow's second step: takes the payment for a reserved order. */
export const handler = async (order: Order & { reserved: boolean }): Promise<{ orderId: string; charged: boolean }> => ({
  orderId: order.orderId,
  charged: order.reserved,
});
