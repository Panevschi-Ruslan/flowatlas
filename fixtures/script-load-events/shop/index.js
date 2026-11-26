const express = require('express');

const app = express();
app.use(express.json());

app.get('/items', (req, res) => {
  res.json({ page: req.query.page, items: [] });
});

app.post('/orders', (req, res) => {
  res.status(201).json({ item: req.body.item });
});

app.get('/cart', (_req, res) => {
  res.json([]);
});

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.get('/reviews', (req, res) => {
  res.json({ page: req.query.page, reviews: [] });
});

app.get('/stock/levels', (_req, res) => {
  res.json([]);
});

app.get('/legacy', (_req, res) => {
  res.json([]);
});

app.listen(4730);
