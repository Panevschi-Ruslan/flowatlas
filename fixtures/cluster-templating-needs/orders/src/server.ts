import express from 'express';

/** Orders, named, labelled and given its port by a transformer kustomization built before its transformers run. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT ?? 3000));
