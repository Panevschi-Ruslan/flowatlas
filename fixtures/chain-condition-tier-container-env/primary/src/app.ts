import express from 'express';

/** Reached through PRIMARY_URL, the first setting of the chain. */
const app = express();

app.get('/primary-only', (_req, res) => {
  res.json([]);
});

app.listen(4201);
