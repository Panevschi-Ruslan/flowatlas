import Router from '@koa/router';

/** The same plugin's authentication router, held in the registry as a pair. */
const router = new Router();

router.get('/passkey', async (ctx) => {
  ctx.body = 'ok';
});

export default router;
