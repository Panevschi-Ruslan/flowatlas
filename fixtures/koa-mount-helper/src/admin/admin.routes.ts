import Router from '@koa/router';
import type { Context } from 'koa';

/**
 * Routes whose address depends on a helper this tool has no record of.
 *
 * Whatever prefix `underFlag` gives them, if it gives them one at all, is
 * written in a function of this repository under a meaning only this repository
 * knows. So these two lines are the case the ticket for the described helper
 * must not break: a missing address, said out loud.
 */
export const adminRouter = new Router();

adminRouter.get('/users.list', async (ctx: Context) => {
  ctx.body = [];
});
