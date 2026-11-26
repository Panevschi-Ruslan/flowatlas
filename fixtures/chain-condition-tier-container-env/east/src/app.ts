import express from 'express';

/** Reached through EAST_URL, the first branch of the condition after the first setting. */
const app = express();

app.get('/regions', (_req, res) => {
  res.json([]);
});

app.listen(4202);
