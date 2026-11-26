import express from 'express';

/** Listens on PORT, 3000 where nothing gives it; the cluster's config map gives 7000. */
const app = express();

app.get('/entries', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
