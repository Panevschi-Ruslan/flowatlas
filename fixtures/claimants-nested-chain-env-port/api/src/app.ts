import express from 'express';

/**
 * Listens on API_PORT, and on 3000 only where it is not given; the
 * development environment file gives it 4000.
 */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.listen(process.env.API_PORT ?? 3000);
