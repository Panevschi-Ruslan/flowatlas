import express from 'express';

/** Orders listens on 3001. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.get('/orders/:id', (_req, res) => {
  res.json([]);
});

app.listen(3001);
