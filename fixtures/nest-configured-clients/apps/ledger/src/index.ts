import { Hono } from 'hono';
import { trpcServer } from '@hono/trpc-server';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

/** The ledger's tree, served under `/rpc`. */
export const ledgerRouter = t.router({
  entries: t.router({
    record: t.procedure.input(z.object({ orderId: z.string(), amount: z.number() })).mutation(() => ({ recorded: true })),
  }),
});

const app = new Hono();

app.use('/rpc/*', trpcServer({ router: ledgerRouter, endpoint: '/rpc' }));

export default app;
