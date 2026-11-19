import Router from '@koa/router';
import Koa from 'koa';
import type { Context } from 'koa';

/**
 * Audit listens wherever `PORT` says, with no fallback in the code: the port
 * is the one its example environment file writes, 3005, which is the
 * ledger's as well.
 */
const app = new Koa();
const router = new Router();

router.get('/entries', async (ctx: Context) => {
  ctx.body = [];
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(process.env.PORT);
