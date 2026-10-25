import type { Order } from '../lib/clients';

/** Invoked by the fulfilment workflow's `ReserveStock` step. */
export const handler = async (order: Order): Promise<{ reserved: string[] }> => ({ reserved: order.items });
