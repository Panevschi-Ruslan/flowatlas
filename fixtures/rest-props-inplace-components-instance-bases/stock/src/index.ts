import express from 'express';

const app = express();

app.get('/board', (_req, res) => {
  res.json({});
});

app.get('/chart', (_req, res) => {
  res.json({});
});

app.get('/badge', (_req, res) => {
  res.json({});
});

app.get('/v2/levels', (_req, res) => {
  res.json([]);
});

app.get('/v2/summary', (_req, res) => {
  res.json({});
});

app.get('/levels', (_req, res) => {
  res.json([]);
});

app.get('/mirror', (_req, res) => {
  res.json([]);
});

app.listen(4700);
