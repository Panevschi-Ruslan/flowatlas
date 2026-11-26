import express from 'express';

const app = express();

app.get('/feed', (_req, res) => {
  res.json([]);
});

app.get('/panel', (_req, res) => {
  res.json({});
});

app.get('/field', (_req, res) => {
  res.json({});
});

app.get('/both', (_req, res) => {
  res.json({});
});

app.get('/tile', (_req, res) => {
  res.json({});
});

app.get('/v2/levels', (_req, res) => {
  res.json([]);
});

app.get('/levels', (_req, res) => {
  res.json([]);
});

app.get('/mirror', (_req, res) => {
  res.json([]);
});

app.listen(4700);
