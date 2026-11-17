import express from 'express';

/** Declares its routes; the server is started somewhere the reader does not follow. */
export const app = express();

app.get('/things', (_req, res) => {
  res.json([]);
});
