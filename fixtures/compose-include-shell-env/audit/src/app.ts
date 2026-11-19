import express from 'express';

/** Listens on PORT, 5000 where nothing gives it; the chart's image is not settled. */
const app = express();

app.get('/log', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 5000);
