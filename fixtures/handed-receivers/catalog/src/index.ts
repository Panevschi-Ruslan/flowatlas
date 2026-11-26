import express from 'express';

const app = express();
app.use(express.json());

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/products', (_req, res) => {
  res.json([]);
});

app.post('/orders/:id/notes', (req, res) => {
  res.status(201).json({ text: req.body.text });
});

app.put('/files', (_req, res) => {
  res.status(204).end();
});

app.get('/status', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(4600);
