import express from 'express';

/** Orders listens on 3000; the cluster reaches it at orders:80. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(3000);
