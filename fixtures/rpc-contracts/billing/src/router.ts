import { initTRPC } from '@trpc/server';
import { z } from 'zod';

const t = initTRPC.create();

const InvoiceFor = z.object({ orderId: z.string() });
const ByOrder = z.object({ orderId: z.string() });
const Voided = z.object({ invoiceId: z.string() });

/**
 * The tree the worker's injected clients and the portal ask. Every procedure
 * declares its input; the worker's typed client is typed `any`, so what it
 * reads back has no type at its end.
 */
export const appRouter = t.router({
  invoices: t.router({
    create: t.procedure.input(InvoiceFor).mutation(({ input }) => ({ id: `i-${(input as { orderId: string }).orderId}` })),
    byOrder: t.procedure.input(ByOrder).query(() => [{ id: 'i-1', total: 12 }]),
    void: t.procedure.input(Voided).mutation(() => ({ voided: true })),
  }),
});
