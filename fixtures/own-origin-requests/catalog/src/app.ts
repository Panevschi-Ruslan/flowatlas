import express from 'express';

/** Catalog listens on 3003. */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.listen(3003);
