import express from 'express';

/** Stock listens on PORT, which its pods are given as 4000. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT) || 3000);
