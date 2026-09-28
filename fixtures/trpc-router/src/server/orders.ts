import { authedProcedure, publicProcedure } from './procedures';
import { listOrders, storeOrder } from './orders-store';
import { router } from './trpc';

export const OrderQuery = { customerId: '' };
export const OrderBody = { sku: '', quantity: 0 };

export const ordersRouter = router({
  // A named function handed over, so the code behind the way in has a name to
  // point at and an edge into it.
  list: publicProcedure.input(OrderQuery).query(listOrders),
  // A body written in place, which is the ordinary spelling and the one that
  // leaves nothing named. The way in is real either way.
  create: authedProcedure.input(OrderBody).mutation(async ({ input }) => {
    const body = input as { sku: string; quantity: number };
    return storeOrder(body);
  }),
});
