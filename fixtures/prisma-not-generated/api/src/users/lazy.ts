import type { PrismaClient } from '@acme/db';

/** Only the part of the client this helper is allowed, which is still the client. */
type Orders = Pick<PrismaClient, 'order'>;

/** A client loaded when the handler first runs, by an import written as an expression. */
export const firstUser = async (): Promise<unknown> => {
  const prisma = (await import('@acme/db')).default;
  return prisma.user.findUnique({ where: { id: '1' } });
};

export const lastUser = async (): Promise<unknown> => {
  const prisma = await import('@acme/db').then((mod) => mod.default);
  return prisma.user.findFirst();
};

export const settle = (db: Orders): Promise<unknown> => db.order.updateMany({ data: {} });

/** The same import with its export taken by a pattern, which is how a scheduling app's logo route writes it. */
export const someUsers = async (): Promise<unknown> => {
  const { default: prisma } = await import('@acme/db');
  return prisma.user.findMany();
};
