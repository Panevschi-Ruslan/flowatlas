import express from 'express';

/** Listens on 3000. */
const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});
app.listen(3000);
