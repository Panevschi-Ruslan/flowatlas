import express from 'express';

/** Listens on PORT: bin/serve.js at the top of the project imports this package by its name. */
const app = express();

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
