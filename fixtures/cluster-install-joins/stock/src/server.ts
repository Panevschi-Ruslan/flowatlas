import express from 'express';

/** Stock, run in the cluster from its kustomization; its port is the config map's. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT) || 4000);
