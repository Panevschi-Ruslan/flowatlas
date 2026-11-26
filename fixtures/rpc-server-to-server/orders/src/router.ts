import { os } from '@orpc/server';
import { findOrder, saveOrder } from './store';

/**
 * The tree the worker's client asks. Its keys are the addresses: the worker
 * writes `orders.place` and `orders.get`, and nothing here declares the
 * `orders.audit` it also asks for.
 */
export const router = {
  orders: {
    place: os.handler(async ({ input }) => saveOrder(input as { sku: string; quantity: number })),
    get: os.handler(async ({ input }) => findOrder((input as { id: string }).id)),
  },
};
