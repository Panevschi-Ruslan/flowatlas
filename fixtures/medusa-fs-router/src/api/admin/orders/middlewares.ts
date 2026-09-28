import { authenticate, validateBody, type MiddlewareRoute } from '@medusajs/framework';

/**
 * One repository's own slice of the middleware list, in its own file.
 *
 * This is how a large application of this kind writes it: a const per area, and
 * one list at the root that spreads all of them. Reading only what is written in
 * the root file would read the entries that are there and call several hundred
 * absent, which is the silence this fixture exists to prevent.
 */
export const adminOrderRoutesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: '/admin*',
    middlewares: [authenticate('user', ['bearer', 'session'])],
  },
  {
    // The older of the two spellings for the verbs an entry covers.
    method: 'POST',
    matcher: '/admin/orders',
    middlewares: [validateBody({ id: 'string' })],
  },
];
