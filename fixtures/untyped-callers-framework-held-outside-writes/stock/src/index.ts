import express from 'express';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/levels', (_req, res) => {
  res.json([]);
});

app.get('/recent', (_req, res) => {
  res.json([]);
});

app.get('/ticks', (_req, res) => {
  res.json([]);
});

app.listen(4700);
