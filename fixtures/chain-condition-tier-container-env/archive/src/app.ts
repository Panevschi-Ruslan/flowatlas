import express from 'express';

/** Reached through ARCHIVE_URL, read after the condition. */
const app = express();

app.get('/exports', (_req, res) => {
  res.json([]);
});

app.listen(4204);
