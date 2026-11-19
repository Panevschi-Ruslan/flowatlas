import express from 'express';

/** One of the two services the configuration says ORDERS_URL reaches. */
const app = express();

app.get('/orders/open', (_req, res) => {
  res.json([]);
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4101);
