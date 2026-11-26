import express from 'express';

/** Listens on PORT: the Makefile starts it with one of two, by whether CI is set. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
