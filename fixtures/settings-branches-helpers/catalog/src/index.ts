import express from 'express';

const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/categories', (_req, res) => {
  res.json([]);
});

app.listen(4600);
