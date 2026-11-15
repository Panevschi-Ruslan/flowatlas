import express from 'express';

/** The orders service a production build reaches through ORDERS_URL. */
const app = express();

app.get('/orders/open', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4100);
