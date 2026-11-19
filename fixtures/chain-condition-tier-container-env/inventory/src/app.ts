import express from 'express';

/** Listens on PORT, and on 3000 only where nothing gives it. */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
