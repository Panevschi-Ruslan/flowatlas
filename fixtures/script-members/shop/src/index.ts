import express from 'express';

const app = express();
app.use(express.json());

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/items/:id', (req, res) => {
  res.json({ id: req.params.id });
});

app.get('/items/:id/reviews', (_req, res) => {
  res.json([]);
});

app.post('/cart', (req, res) => {
  res.status(201).json({ item: req.body.item, quantity: req.body.quantity });
});

app.delete('/cart', (_req, res) => {
  res.status(204).end();
});

app.get('/account', (_req, res) => {
  res.json({ name: 'guest' });
});

app.put('/account', (req, res) => {
  res.json({ name: req.body.name });
});

app.listen(4700);
