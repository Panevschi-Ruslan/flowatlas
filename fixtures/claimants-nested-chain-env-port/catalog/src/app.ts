import express from 'express';

/** Reached through CATALOG_URL, one branch of a condition. */
const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});

app.listen(4103);
