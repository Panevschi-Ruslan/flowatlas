import express from 'express';

const app = express();
app.use(express.json());

app.post('/notes', (req, res) => {
  res.status(201).json({ text: req.body.text });
});

app.put('/drafts', (_req, res) => {
  res.status(204).end();
});

app.get('/v1/products', (_req, res) => {
  res.json([]);
});

app.get('/v2/products', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(4600);
