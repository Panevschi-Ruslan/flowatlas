import express from 'express';

/** Orders, run in the cluster. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.get('/orders/:id', (_req, res) => {
  res.json([]);
});

app.listen(3000);
