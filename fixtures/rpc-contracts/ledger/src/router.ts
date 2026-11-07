import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

const Entry = z.object({ orderId: z.string(), amount: z.number() });

/** The ledger's one procedure, served by a standalone server at /api. */
export const ledgerRouter = t.router({
  entries: t.router({
    record: t.procedure.input(Entry).mutation(() => ({ recorded: true })),
  }),
});
