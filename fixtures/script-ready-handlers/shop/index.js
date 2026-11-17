const express = require('express');
const { listItems } = require('./items');
const catalog = require('./items');

const app = express();
app.use(express.json());

app.get('/items', (req, res) => {
  res.json(listItems(Number(req.query.page ?? 1)));
});

app.get('/items/:id', (req, res) => {
  res.json(catalog.findItem(Number(req.params.id)));
});

app.get('/reviews', (req, res) => {
  res.json({ page: req.query.page, reviews: [] });
});

app.get('/orders', (req, res) => {
  res.json({ page: req.query.page, orders: [] });
});

app.post('/orders', (req, res) => {
  res.status(201).json({ item: req.body.item });
});

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.get('/catalog', (_req, res) => {
  res.json([]);
});

app.listen(4720);
