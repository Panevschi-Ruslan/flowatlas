import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const archiveOrder = () => ({ archived: true });

/**
 * A tree the web front end is not configured to call, declaring the one path it
 * asks for and `api` does not. The join refuses to go here on the strength of the
 * string alone, and the row it writes instead names this service.
 */
export const adminRouter = t.router({
  orders: t.router({
    archive: t.procedure.mutation(archiveOrder),
  }),
});
