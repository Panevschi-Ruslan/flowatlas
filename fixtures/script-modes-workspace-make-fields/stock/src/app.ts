import express from 'express';

/** Listens on PORT: mk/stock.mk's recipe, read with the Makefile that includes it. */
const app = express();

app.get('/levels', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
