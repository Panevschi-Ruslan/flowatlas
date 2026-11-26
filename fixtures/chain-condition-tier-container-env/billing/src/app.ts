import express from 'express';

/** Listens on BILLING_PORT, and on 3000 only where nothing gives it. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});

app.listen(process.env.BILLING_PORT ?? 3000);
