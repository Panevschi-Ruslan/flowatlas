import express from 'express';

/** Stock, run in the cluster. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.get('/stock/:sku', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT) || 3000);
