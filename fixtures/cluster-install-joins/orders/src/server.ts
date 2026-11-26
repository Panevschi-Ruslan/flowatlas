import express from 'express';

/** Orders, run in the cluster from the shop chart the helmfile installs. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(3000);
