import express from 'express';

/** Reached through WEST_URL, the second branch of the condition after the first setting. */
const app = express();

app.get('/regions', (_req, res) => {
  res.json([]);
});

app.get('/west-only', (_req, res) => {
  res.json([]);
});

app.listen(4203);
