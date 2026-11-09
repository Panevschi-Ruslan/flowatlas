import express from 'express';

/** Catalog, run in the cluster from the shop chart, and installed alone as a preview. */
const app = express();

app.get('/catalog/products', (_req, res) => {
  res.json([]);
});

app.listen(3003);
