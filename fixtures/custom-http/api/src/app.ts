import { createServer } from 'minihttp';
import { authenticate } from './middleware/authenticate';
import { ordersRouter } from './orders/orders.routes';

/**
 * The server that is served, and the only place a base path is written.
 *
 * The guard is installed before the mount, so it stands in front of every
 * route the mounted server declares — which is the fact a description has to
 * be able to carry if it is to say anything useful about a repository.
 */
const app = createServer();

app.use(authenticate);
app.attach('/orders', ordersRouter);
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(3000);

export { app };
