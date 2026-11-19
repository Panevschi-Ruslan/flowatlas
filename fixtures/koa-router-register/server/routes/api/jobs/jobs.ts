import Router from 'koa-router';
import type { Context, Next } from 'koa';

const router = new Router();

const validate = (ctx: Context, next: Next): Promise<void> => {
  if (ctx.get('authorization') === '') {
    ctx.status = 401;
    return Promise.resolve();
  }
  return next();
};

/** Runs the scheduled jobs of the interval the address names. */
const runJobs = async (ctx: Context): Promise<void> => {
  ctx.body = { interval: ctx.params['interval'], ran: true };
};

/**
 * One handler under two verbs, registered with the method every verb method
 * calls: the address, the verbs as a list, and the middleware as a list whose
 * last member answers (P270).
 */
router.register('jobs.:interval', ['get', 'post'], [validate, runJobs]);

// The same handler at a second address.
router.register('maintenance.sweep', ['get', 'post'], [validate, runJobs]);

// Verbs nothing can read: a row, not a route.
const verbs = process.env['JOB_VERBS']?.split(',') ?? [];
router.register('jobs.manual', verbs, runJobs);

export default router;
