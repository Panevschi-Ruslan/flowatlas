import express from 'express';

/** Listens on PORT; the Makefile's ledger target exports 4710. */
const app = express();

app.get('/entries', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
