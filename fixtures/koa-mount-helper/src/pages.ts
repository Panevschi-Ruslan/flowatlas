import Router from '@koa/router';
import Koa from 'koa';
import type { Context } from 'koa';

/**
 * An application the helper is handed on its own, which outline also writes.
 *
 * `mount(pages)` has no prefix argument at all: the helper mounts the
 * application at its parent's base. The described row says argument 0 spells the
 * prefix, and here argument 0 *is* the application — which is the answer rather
 * than an absence, and is why the row can be two positions and no condition.
 */
export const pages = new Koa();

const pagesRouter = new Router();

pagesRouter.get('/pages.list', async (ctx: Context) => {
  ctx.body = [];
});

pages.use(pagesRouter.routes());
