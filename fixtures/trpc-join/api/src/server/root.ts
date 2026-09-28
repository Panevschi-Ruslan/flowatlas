import { procedure, router } from './trpc';

export const OrderQuery = { customerId: '' };
export const OrderBody = { sku: '', quantity: 0 };

export const listOrders = ({ input }: { ctx: unknown; input: unknown }) => {
  const query = input as { customerId: string };
  return [{ id: 'ord-1', customerId: query.customerId }];
};

export const createOrder = ({ input }: { ctx: unknown; input: unknown }) => ({
  id: 'ord-2',
  ...(input as { sku: string; quantity: number }),
});

export const dailyTotals = () => [{ day: '2026-01-01', total: 12 }];

export const appRouter = router({
  orders: router({
    list: procedure.input(OrderQuery).query(listOrders),
    create: procedure.input(OrderBody).mutation(createOrder),
  }),
  reports: router({
    daily: procedure.query(dailyTotals),
  }),
});
