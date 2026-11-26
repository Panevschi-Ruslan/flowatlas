import { Hono } from 'hono';
import { trpcServer } from '@hono/trpc-server';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

/** The orders tree, served under `/trpc`. */
export const ordersRouter = t.router({
  orders: t.router({
    place: t.procedure.input(z.object({ sku: z.string(), quantity: z.number() })).mutation(({ input }) => ({ id: `o-${input.sku}` })),
  }),
});

const app = new Hono();

app.use('/trpc/*', trpcServer({ router: ordersRouter, endpoint: '/trpc' }));

export default app;
