import express from 'express';

/**
 * Falls back to 3100 where PORT is not given, and nothing in the repository
 * gives it: a guess at the port the audit service listens on.
 */
const app = express();

app.get('/reports', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3100);
