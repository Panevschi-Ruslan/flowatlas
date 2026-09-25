import type { Context, Next } from 'koa';

/**
 * The guard equivalent, installed on the Koa application.
 *
 * Which routes it covers is decided by where the routers are installed around
 * it: `app.use(authenticate)` above `app.use(ordersRouter.routes())` is how a
 * Koa repository says every route on that router is behind a token.
 */
export const authenticate = async (ctx: Context, next: Next): Promise<void> => {
  if (ctx.get('authorization') === '') {
    ctx.status = 401;
    return;
  }
  await next();
};

/** Installed on one router, covering the routes declared after it. */
export const withTenant = async (ctx: Context, next: Next): Promise<void> => {
  if (ctx.get('x-tenant') === '') {
    ctx.status = 400;
    return;
  }
  await next();
};

/** Written beside one route's handler. */
export const requireAdmin = async (ctx: Context, next: Next): Promise<void> => {
  if (ctx.get('x-role') !== 'admin') {
    ctx.status = 403;
    return;
  }
  await next();
};
