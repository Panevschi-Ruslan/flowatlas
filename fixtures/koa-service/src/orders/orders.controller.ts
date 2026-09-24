import type { Context } from 'koa';
import { orders } from './orders.repository';

/** A handler with a name, registered by that name. */
export const listOrders = async (ctx: Context): Promise<void> => {
  ctx.body = await orders.list();
};
