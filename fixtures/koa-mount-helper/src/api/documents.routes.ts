import Router from '@koa/router';
import type { Context } from 'koa';

/**
 * Routes written with no prefix of their own, as outline's are.
 *
 * Every address in this file is the one the router declares. Where it is served
 * depends entirely on the mount two files up, and if that mount cannot be read
 * then neither can these addresses — which is the point of the fixture.
 */
export const documentsRouter = new Router();

documentsRouter.post('/documents.info', async (ctx: Context) => {
  ctx.body = { id: 'doc-1' };
});

documentsRouter.post('/documents.list', async (ctx: Context) => {
  ctx.body = [];
});
