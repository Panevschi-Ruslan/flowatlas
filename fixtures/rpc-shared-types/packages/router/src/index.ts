import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

const NewOrder = z.object({ sku: z.string(), quantity: z.number() });
const OrderId = z.object({ id: z.string() });

/**
 * The orders tree, kept in a package of its own so the server that serves it
 * and every client that calls it are typed from the one declaration.
 */
export const appRouter = t.router({
  orders: t.router({
    place: t.procedure.input(NewOrder).mutation(({ input }) => ({ id: `o-${input.sku}` })),
    get: t.procedure.input(OrderId).query(({ input }) => ({ id: input.id, sku: 'sku-1', quantity: 1 })),
  }),
});

/** What every client of the tree is typed with. */
export type AppRouter = typeof appRouter;
