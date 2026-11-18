import express from 'express';

const app = express();

app.get('/feed', (_req, res) => {
  res.json([]);
});

app.get('/panel', (_req, res) => {
  res.json({});
});

app.get('/field', (_req, res) => {
  res.json({});
});

app.get('/both', (_req, res) => {
  res.json({});
});

app.get('/tile', (_req, res) => {
  res.json({});
});

app.get('/account/profile', (_req, res) => {
  res.json({});
});

app.get('/summary', (_req, res) => {
  res.json({});
});

app.get('/pulse', (_req, res) => {
  res.json({ ok: true });
});

app.get('/tick', (_req, res) => {
  res.json({ ok: true });
});

app.listen(4600);
