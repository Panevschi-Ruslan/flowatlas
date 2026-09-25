import type { Request, Response } from 'express';
import { orders } from './orders.repository';

/**
 * A handler with a name, registered by that name.
 *
 * The name is what the graph can point at, and the walk from the route goes on
 * from here into the data the repository reads.
 */
export const listOrders = async (req: Request, res: Response): Promise<unknown> => {
  const found = await orders.list();
  return res.json(found);
};
