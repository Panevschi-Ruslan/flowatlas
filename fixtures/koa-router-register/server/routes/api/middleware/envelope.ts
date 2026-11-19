import type { Context, Next } from 'koa';

/**
 * A middleware factory kept beside the routes. The directory is called
 * `server/routes`, which is also where a Nitro server keeps the files it
 * serves; nothing here is served, and the counting rule no longer counts it as
 * a route file (P270).
 */
export default function envelope() {
  return async function envelopeMiddleware(ctx: Context, next: Next): Promise<void> {
    await next();
    ctx.body = { data: ctx.body };
  };
}
