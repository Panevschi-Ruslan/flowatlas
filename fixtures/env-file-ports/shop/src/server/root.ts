import { procedure, router } from './trpc';

export const listOrders = () => [{ id: 'ord-1' }];

export const appRouter = router({
  orders: router({
    list: procedure.query(listOrders),
  }),
});
