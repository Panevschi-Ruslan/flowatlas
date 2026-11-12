import express from 'express';

const app = express();

app.get('/api/entries', (_req, res) => {
  res.json([]);
});

app.listen(4400);
