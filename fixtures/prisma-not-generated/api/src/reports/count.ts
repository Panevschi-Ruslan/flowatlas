import type { PrismaClient } from '@acme/db';

interface Options {
  ctx: { prisma: PrismaClient };
}

/** A client carried in a context object, reached destructured and directly. */
export const countUsers = ({ ctx }: Options): Promise<number> => {
  const { prisma } = ctx;
  return prisma.user.count();
};

export const totals = ({ ctx }: Options): Promise<unknown> => ctx.prisma.order.aggregate({});
