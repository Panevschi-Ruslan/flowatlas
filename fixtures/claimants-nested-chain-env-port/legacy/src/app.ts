import express from 'express';

/** The other service ORDERS_URL is claimed by, an older one. */
const app = express();

app.get('/v1/orders', (_req, res) => {
  res.json([]);
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4102);
