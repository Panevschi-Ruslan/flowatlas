import type { Order } from '../lib/orders';

/** The shipping workflow's first step: holds the items of an order. */
export const handler = async (order: Order): Promise<Order & { reserved: boolean }> => ({ ...order, reserved: order.items.length > 0 });
