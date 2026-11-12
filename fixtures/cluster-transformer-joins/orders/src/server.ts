import express from 'express';

/** Orders, built by a kustomization whose transformer and generator files name it, label it and give it its port. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT ?? 3000));
