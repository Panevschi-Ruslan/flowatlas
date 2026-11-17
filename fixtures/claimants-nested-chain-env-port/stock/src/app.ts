import express from 'express';

/** Reached through STOCK_URL, the other branch of the condition. */
const app = express();

app.get('/levels', (_req, res) => {
  res.json([]);
});

app.listen(4104);
