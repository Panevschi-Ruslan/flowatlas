import express from 'express';

/** Listens on PORT, which its pods take from a Secret. */
const app = express();

app.get('/balances', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
