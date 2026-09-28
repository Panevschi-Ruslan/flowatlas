import { prisma } from './db';
import { procedure } from './trpc';

export const publicProcedure = procedure;

// A starting point built once at the top of a module, with its guard written in
// place. The guard reads the database, and nothing annotates `ctx`: its type is
// whatever the root was created with.
export const orderOwnerProcedure = procedure.use(async ({ ctx, next }) => {
  const order = await ctx.prisma.order.findFirst({ where: { ownerId: ctx.userId } });
  if (!order) throw new Error('NOT_FOUND');
  return next({ ctx: { order } });
});

// The same, with the client imported rather than handed over.
export const auditedProcedure = procedure.use(async ({ next }) => {
  await prisma.auditLog.create({ data: { at: new Date() } });
  return next();
});

// A starting point no way in begins from. Its guard is still code the module
// holds, and it still reads the database.
export const unusedProcedure = procedure.use(async ({ ctx, next }) => {
  await ctx.prisma.user.count();
  return next();
});
