import express from 'express';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/feed', (_req, res) => {
  res.json([]);
});

app.get('/panel', (_req, res) => {
  res.json({});
});

app.get('/list', (_req, res) => {
  res.json([]);
});

app.listen(4600);
