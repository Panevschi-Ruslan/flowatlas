/**
 * The data layer, written as a module of exported functions rather than as a class.
 *
 * This is the ordinary shape in a repository built on the file-system router:
 * there is no container to ask for a repository, so the queries live in module
 * functions the route handlers import. The data-layer reader reads that shape,
 * and it runs here, because this repository is read by the reader that owns
 * that pass and opens the `.tsx` files beside these ones as well.
 *
 * It is the same client and the same delegate-per-model spelling as the NestJS
 * fixture uses, so that the two can be compared: whatever the reader records
 * for a query in a method it has to record for the same query in a function.
 */
import { PrismaClient, type Order } from '@prisma/client';

const prisma = new PrismaClient();

/** A read, on the model named by the property the call was made on. */
export const listOrders = async (): Promise<Order[]> => prisma.order.findMany();

export const findOrder = async (id: string): Promise<Order | null> =>
  prisma.order.findUnique({ where: { id } });

/** A write, from a function that is exported and called by a route handler. */
export const saveOrder = async (order: Order): Promise<Order> =>
  prisma.order.create({ data: order });

export const patchOrder = async (id: string, patch: Partial<Order>): Promise<Order> =>
  prisma.order.update({ where: { id }, data: patch });

/**
 * A function that reaches the store through another function of this module.
 *
 * The server action calls this one, so the flow from a screen with no address
 * in it ends at a query two functions away.
 */
export const archive = async (id: string): Promise<void> => {
  await patchOrder(id, { status: 'archived' });
};
