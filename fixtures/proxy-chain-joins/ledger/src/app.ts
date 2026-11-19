import express from 'express';

/** Ledger listens on 3006. */
const app = express();

app.get('/v2/invoices', (_req, res) => {
  res.json([]);
});

app.listen(3006);
