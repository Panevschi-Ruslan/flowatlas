import Router from '@koa/router';
import type { Context } from 'koa';

/** Installed on the server itself, so its address is readable and is read. */
export const healthRouter = new Router({ prefix: '/health' });

healthRouter.get('/', async (ctx: Context) => {
  ctx.body = 'ok';
});
