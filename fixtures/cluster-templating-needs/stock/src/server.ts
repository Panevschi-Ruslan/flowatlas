import express from 'express';

/** Stock, installed only because the release a selector keeps needs it, from another sub-helmfile. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(3001);
