import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

/** The ledger's tree, served by the edge application twice. */
export const ledgerRouter = t.router({
  entries: t.router({
    record: t.procedure.input(z.object({ orderId: z.string(), amount: z.number() })).mutation(() => ({ recorded: true })),
  }),
});
