import Router from 'koa-router';
import type { Context } from 'koa';
import paging from '../middleware/paging';

const router = new Router();

/** A route declared by its verb, with a middleware the factory makes in front of it. */
router.post('products.list', paging(), async (ctx: Context) => {
  ctx.body = [];
});

export default router;
