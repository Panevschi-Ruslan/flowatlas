import type { Context, Next } from 'koa';

/** Another factory beside the routes: what it hands back reads the page asked for. */
export default function paging() {
  return async function pagingMiddleware(ctx: Context, next: Next): Promise<void> {
    ctx.state['pagination'] = { offset: Number(ctx.query['offset'] ?? 0), limit: 25 };
    await next();
  };
}
