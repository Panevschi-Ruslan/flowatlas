import Router from '@koa/router';

/**
 * A plugin's API router, which nothing in this repository imports.
 *
 * It is reached only through the registry, and its paths are written without a
 * leading slash because that is how the application it is mounted on writes
 * them: the address is `/api/passkeys.list`, and every segment of that but the
 * last comes from two mounts in two other files.
 */
const router = new Router();

router.post('passkeys.list', async (ctx) => {
  ctx.body = { data: [] };
});

router.post('passkeys.update', async (ctx) => {
  ctx.body = { data: {} };
});

export default router;
