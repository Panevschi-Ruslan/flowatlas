import express from 'express';

/** Listens on PORT, 3000 where nothing gives it. */
const app = express();

app.get('/invoices', (_req, res) => {
  res.json([]);
});
app.listen(Number(process.env.PORT) || 3000);
