const express = require('express');

const app = express();
app.use(express.json());

app.get('/catalog', (_req, res) => {
  res.json([]);
});

app.post('/orders', (req, res) => {
  res.status(201).json({ item: req.body.item });
});

app.get('/promos', (_req, res) => {
  res.json([]);
});

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.get('/deals', (_req, res) => {
  res.json([]);
});

app.listen(4750);
