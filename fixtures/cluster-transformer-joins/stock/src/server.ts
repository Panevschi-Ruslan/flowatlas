import express from 'express';

/** Stock, installed from a chart whose port comes up from a dependency of its dependency. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(3001);
