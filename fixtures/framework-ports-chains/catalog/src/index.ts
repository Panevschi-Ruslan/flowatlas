import express from 'express';

const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(4600);
