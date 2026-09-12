import type { MiddlewareHandler } from 'hono';

/** Middleware, not a way in: it runs between a request and whatever answers it. */
export const withNest: MiddlewareHandler = async (c, next) => {
  c.set('booted', true);
  await next();
};

/** The same, and installed with `use`, which declares no route at all. */
export const requestLogger: MiddlewareHandler = async (_c, next) => {
  await next();
};
