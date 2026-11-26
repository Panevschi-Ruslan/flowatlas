const express = require('express');

const app = express();
app.use(express.json());

app.get('/catalog', (_req, res) => {
  res.json([]);
});

app.post('/visits', (req, res) => {
  res.status(201).json({ page: req.body.page });
});

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.get('/cart', (_req, res) => {
  res.json([]);
});

app.get('/promos', (_req, res) => {
  res.json([]);
});

app.get('/deals', (_req, res) => {
  res.json([]);
});

app.listen(4740);
