import express from 'express';

/** Payments, installed by one sub-helmfile after the release another declares. */
const app = express();

app.post('/payments', (_req, res) => {
  res.status(201).json({ ok: true });
});

app.listen(3002);
