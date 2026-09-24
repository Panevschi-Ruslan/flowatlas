import Router from '@koa/router';
import type { Context } from 'koa';
import { requireAdmin, withTenant } from '../middleware/guards';
import { listOrders } from './orders.controller';
import { orders } from './orders.repository';

/** What a request may carry, where the route says so and only there. */
export interface CreateOrder {
  total: number;
}

const archivePath = (name: string): string => `/${name}/archive`;

/**
 * The prefix is the constructor's, which is where a Koa router usually carries
 * it. Nothing at the place this router is installed says `/orders`.
 */
export const ordersRouter = new Router({ prefix: '/orders' });

// Installed on this router, so it covers every route declared below it.
ordersRouter.use(withTenant);

// A handler named elsewhere and registered by name.
ordersRouter.get('/', listOrders);

// A handler written in the registration.
ordersRouter.get('/:orderId', async (ctx: Context) => {
  ctx.body = await orders.byId(ctx.params['orderId'] as string);
});

// Middleware between the path and the handler.
ordersRouter.post('/', requireAdmin, async (ctx: Context) => {
  await orders.insert((ctx.request.body as CreateOrder).total);
  ctx.status = 201;
});

// `del` is the alias for the reserved word, and answers the same verb.
ordersRouter.del(archivePath('old'), async (ctx: Context) => {
  ctx.status = 204;
});
