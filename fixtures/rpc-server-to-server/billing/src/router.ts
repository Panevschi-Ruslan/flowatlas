import { initTRPC } from '@trpc/server';
import { invoiceFor, invoicesOf, refund } from './invoices';

const t = initTRPC.create();

/**
 * The tree the worker asks for `invoices.create`, `invoices.byOrder` and
 * `invoices.refund`, and subscribes to `invoices.paid` over a socket.
 */
export const appRouter = t.router({
  invoices: t.router({
    create: t.procedure.mutation(({ input }) => invoiceFor((input as { orderId: string }).orderId)),
    byOrder: t.procedure.query(({ input }) => invoicesOf((input as { orderId: string }).orderId)),
    refund: t.procedure.mutation(({ input }) => refund((input as { invoiceId: string }).invoiceId)),
    paid: t.procedure.subscription(() => null),
  }),
});
