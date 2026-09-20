import { Hono, type Context } from 'hono';
import { adminRoutes } from './admin/admin.routes';
import { registerReports } from './admin/reports.routes';
import { requestLogger, withNest } from './middleware/with-nest';
import { OrdersService } from './orders/orders.service';
import { orderStream, stockStream } from './stream/sse';

/**
 * The second framework of this repository.
 *
 * A worker in front of the Nest application: it answers the routes that have to
 * stay outside it — the held-open streams, the probes — and hands everything
 * else to it. Both are one repository, one reader, one `services[].type`.
 */
const app = new Hono();

const pathFor = (name: string): string => `/api/_${name}`;

// Middleware. Not a route, and must not be read as one.
app.use('*', requestLogger);

// A handler written in the declaration, delegating to nothing named.
app.get('/health', (c) => c.json({ status: 'ok' }));

// The two the admin panel opens. Named functions, and the `/api` the Nest side
// gets from `setGlobalPrefix` is written out here because nothing adds it.
app.get('/api/depots/:depotId/stream', orderStream);
app.get('/api/depots/:depotId/stock-stream', stockStream);

// Middleware between the path and the handler, which is where a route's guards
// go when there are no decorators to hang them on. The handler calls a function
// of this repository by name and then carries on, so that call is plumbing
// rather than the answer and nothing is pointed at.
app.post('/api/messenger/webhook', withNest, async (c) => {
  const container = await boot();
  const orders: OrdersService = container.get('orders');
  await orders.cancel('r1', 'o1');
  return c.json({ ok: true });
});

// A verb given as an argument rather than as the method.
app.on('DELETE', '/api/depots/:depotId/cache', (c) => c.text('cleared'));

// A path assembled at run time: no route to record, and a row saying so.
app.get(pathFor('stats'), (c) => c.text('stats'));

// A sub-application, mounted a level down. Its routes are declared elsewhere.
app.route('/api/admin', adminRoutes);

// An application whose base is shifted, then written on.
const internal = app.basePath('/internal');
internal.post('/reload', (c) => acceptUpdate(c));

// Routes on an application handed to somebody else. Where they are served is
// the caller's business, and this call is not enough to say.
registerReports(app);

/**
 * Everything under `/api` that the worker itself does not answer.
 *
 * The bridge to the other framework: the routes behind it are the Nest
 * controllers, which are already in the graph, so this must never be read as
 * the route that answers a request one of them serves.
 */
app.all('/api/*', async (c) => forwardToNest(c));

export async function acceptUpdate(c: Context): Promise<unknown> {
  const orders: OrdersService = c.get('orders');
  await orders.cancel('r1', 'o1');
  return c.json({ ok: true });
}

async function forwardToNest(c: Context): Promise<unknown> {
  return c.text(`nest:${c.req.param('0')}`);
}

/** Plumbing: what a worker does before it can answer anything at all. */
async function boot(): Promise<{ get(key: string): OrdersService }> {
  return { get: () => new OrdersService() };
}

export default app;
