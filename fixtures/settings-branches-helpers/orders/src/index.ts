import express from 'express';

const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.get('/orders/open', (_req, res) => {
  res.json([]);
});

app.get('/orders/late', (_req, res) => {
  res.json([]);
});

app.listen(4500);
