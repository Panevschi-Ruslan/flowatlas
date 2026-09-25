import Router from '@koa/router';
import type { Context } from 'koa';
import { orders } from '../orders/orders.repository';

/**
 * Installed above the guard, so nothing in front of these can refuse a
 * request — which is what the route audit reports about the one that reads
 * stored data.
 */
export const publicRouter = new Router({ prefix: '/public' });

publicRouter.get('/health', async (ctx: Context) => {
  ctx.body = { status: 'ok' };
});

publicRouter.get('/summary', async (ctx: Context) => {
  ctx.body = { orders: await orders.list() };
});
