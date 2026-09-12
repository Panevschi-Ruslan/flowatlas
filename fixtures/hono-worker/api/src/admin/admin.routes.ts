import { Hono } from 'hono';
import { adminEvents } from '../stream/sse';

/**
 * A sub-application, mounted by the worker rather than served on its own.
 *
 * Its routes are declared here at `/events`, one file and one import away from
 * the `route('/api/admin', …)` that decides where they are answered. Reading the
 * declaration alone would put both of them at the wrong address.
 */
export const adminRoutes = new Hono();

adminRoutes.get('/events', adminEvents);

adminRoutes.get('/orders/:orderId', (c) => c.json({ id: c.req.param('orderId') }));
