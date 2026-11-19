import express from 'express';

/** Listens on 3100, written as a number: firmly there. */
const app = express();

app.get('/audit/log', (_req, res) => {
  res.json([]);
});

app.listen(3100);
