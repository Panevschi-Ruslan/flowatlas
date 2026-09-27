import Router from '@koa/router';

/** A router the application imports, which was never the hard case. */
const router = new Router();

router.post('documents.info', async (ctx) => {
  ctx.body = { data: {} };
});

export default router;
