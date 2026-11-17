import express from 'express';

/** Reached through ARCHIVE_URL, read where neither branch's setting is set. */
const app = express();

app.get('/exports', (_req, res) => {
  res.json([]);
});

app.listen(4105);
