import Router from '@koa/router';
import type { Context } from 'koa';
import { orders } from './orders.repository';

/** The server half: two routes, on the same router the browser half calls. */
export const ordersRouter = new Router({ prefix: '/api/orders' });

ordersRouter.get('/', async (ctx: Context) => {
  ctx.body = await orders.list();
});

ordersRouter.post('/', async (ctx: Context) => {
  await orders.insert((ctx.request.body as { total: number }).total);
  ctx.status = 201;
});
