import express from 'express';

const app = express();

app.get('/board', (_req, res) => {
  res.json({});
});

app.get('/chart', (_req, res) => {
  res.json({});
});

app.get('/row', (_req, res) => {
  res.json({});
});

app.get('/frame', (_req, res) => {
  res.json({});
});

app.get('/v1/profile', (_req, res) => {
  res.json({});
});

app.get('/v1/summary', (_req, res) => {
  res.json({});
});

app.get('/orders/recent', (_req, res) => {
  res.json([]);
});

app.get('/summary', (_req, res) => {
  res.json({});
});

app.listen(4600);
