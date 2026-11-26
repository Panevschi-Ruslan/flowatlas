import express from 'express';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/v1/products', (_req, res) => {
  res.json([]);
});

app.get('/latest', (_req, res) => {
  res.json([]);
});

app.listen(4600);
