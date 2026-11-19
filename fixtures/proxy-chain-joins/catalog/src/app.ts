import express from 'express';

/** Catalog listens on 3003. */
const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});

app.get('/products/:id', (_req, res) => {
  res.json([]);
});

app.listen(3003);
