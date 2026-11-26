import express from 'express';

/** Billing, run in the cluster. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});

app.listen(3004);
