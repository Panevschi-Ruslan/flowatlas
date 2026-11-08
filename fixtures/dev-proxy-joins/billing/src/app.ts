import express from 'express';

/** Billing listens on 3004. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});

app.listen(3004);
