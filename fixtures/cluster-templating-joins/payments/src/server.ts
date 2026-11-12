import express from 'express';

/** Payments, a release a base of the helmfile declares and orders needs. */
const app = express();

app.post('/payments', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3002);
