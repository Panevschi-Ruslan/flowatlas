import express from 'express';

const app = express();

app.get('/checks', (_req, res) => {
  res.json([]);
});

app.get('/admin/checks', (_req, res) => {
  res.json([]);
});

app.listen(4400);
