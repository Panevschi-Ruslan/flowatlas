import { auditedProcedure, orderOwnerProcedure, publicProcedure } from './procedures';
import { router } from './trpc';

export const appRouter = router({
  orders: router({
    mine: orderOwnerProcedure.query(({ ctx }) => ctx),
    stamp: auditedProcedure.mutation(async () => true),
    // The client taken out of `ctx` by name, with nothing annotated anywhere.
    clearDrafts: publicProcedure.mutation(async ({ ctx }) => {
      const { prisma } = ctx;
      await prisma.order.deleteMany({ where: { draft: true } });
    }),
    // A transaction's client, handed to the callback by the client it was
    // opened on.
    archive: publicProcedure.mutation(async ({ ctx }) => {
      await ctx.prisma.$transaction(async (tx) => {
        await tx.order.updateMany({ data: { archived: true } });
      });
    }),
  }),
});
