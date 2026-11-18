import express from 'express';

/** Listens on PORT: scripts/up.sh runs this package's serve with npm -w. */
const app = express();

app.get('/events', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
