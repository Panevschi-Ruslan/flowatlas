import express from 'express';

/** Listens on 4100, written as a number. */
const app = express();

app.get('/audit/log', (_req, res) => {
  res.json([]);
});
app.listen(4100);
