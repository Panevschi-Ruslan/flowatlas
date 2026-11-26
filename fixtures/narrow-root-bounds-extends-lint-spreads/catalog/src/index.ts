import express from 'express';

const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.get('/stock', (_req, res) => {
  res.json({});
});

app.get('/legacy', (_req, res) => {
  res.json({});
});

app.listen(4800);
