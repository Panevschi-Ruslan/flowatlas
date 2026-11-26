import express from 'express';

/** Listens on PORT: the Makefile hands each goal its own. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
