import express from 'express';

/** Listens on PORT: scripts/up.sh runs this package's dev with pnpm --filter. */
const app = express();

app.get('/entries', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
