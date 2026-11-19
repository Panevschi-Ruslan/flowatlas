import { os } from '@orpc/server';
import { z } from 'zod';

const NewOrder = z.object({ sku: z.string(), quantity: z.number() });
const PlacedOrder = z.object({ id: z.string() });
const OrderId = z.object({ id: z.string() });
const Order = z.object({ id: z.string(), sku: z.string(), quantity: z.number() });

/**
 * The tree the worker's client asks. Each procedure declares its input and
 * what it answers, so both ends of every call are compared: `orders.place`
 * takes a `quantity` the worker's copy of this tree calls `qty`, and answers
 * an `id` alone where the copy also reads a `total`.
 */
export const router = {
  orders: {
    place: os
      .input(NewOrder)
      .output(PlacedOrder)
      .handler(async ({ input }) => ({ id: `o-${input.sku}` })),
    get: os
      .input(OrderId)
      .output(Order)
      .handler(async ({ input }) => ({ id: input.id, sku: 'sku-1', quantity: 1 })),
    /** No input at all: what a caller sends is not checked on the way in. */
    count: os.handler(async () => 3),
  },
};
