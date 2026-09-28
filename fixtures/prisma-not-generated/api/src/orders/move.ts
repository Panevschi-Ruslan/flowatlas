import type { Prisma } from '@acme/db/client';

/** A transaction's client, typed from a subpath of the wrapper that re-exports the generated one. */
export const move = (tx: Prisma.TransactionClient): Promise<unknown> =>
  tx.order.update({ where: { id: '1' }, data: {} });
