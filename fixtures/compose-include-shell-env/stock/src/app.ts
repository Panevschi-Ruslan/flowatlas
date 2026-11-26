import express from 'express';

/** Listens on PORT, 3000 where nothing gives it; run-stock.sh exports 4600 before it starts it. */
const app = express();

app.get('/levels', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
