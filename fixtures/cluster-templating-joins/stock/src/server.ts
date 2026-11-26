import express from 'express';

/** Stock, built by a kustomization whose vars give its port and its host. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT ?? 4000));
