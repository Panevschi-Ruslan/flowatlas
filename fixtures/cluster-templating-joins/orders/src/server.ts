import express from 'express';

/** Orders, installed by the helmfile a pipeline applies with the releases it needs. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(3000);
