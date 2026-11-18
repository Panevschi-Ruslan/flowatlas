import express from 'express';

/** Listens on BILLING_PORT alone; compose writes `BILLING_PORT:` and nothing gives it a value. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});
app.listen(process.env.BILLING_PORT);
