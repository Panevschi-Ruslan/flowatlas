import express from 'express';

import { AdminRouter } from './admin.routes';
import { catalogRouter } from './catalog.routes';
import { ordersRouter } from './orders.routes';

/**
 * `express` is declared and not installed, so `app` has no type. The default
 * export of `express`, called right here and held by a `const`, is the
 * application itself, and its routes carry what a typed reading carries (P346).
 */
const app = express();

app.use(express.json());
app.use('/api/orders', ordersRouter);
app.use('/api/catalog', catalogRouter);

const admin = new AdminRouter();
admin.get('/stats', (_req, res) => {
  res.json({ orders: 1 });
});
app.use('/api/admin', admin);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
