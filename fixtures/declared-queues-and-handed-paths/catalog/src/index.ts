import express from 'express';

const app = express();
app.use(express.json());

// The shop's root: no request above is sent here.
app.get('/', (_req, res) => {
  res.json({ name: 'shop' });
});

app.post('/', (_req, res) => {
  res.status(204).end();
});

app.get('/products', (_req, res) => {
  res.json([]);
});

app.get('/products/:id', (req, res) => {
  res.json({ id: req.params.id });
});

app.post('/orders', (_req, res) => {
  res.status(201).json({});
});

app.listen(4600);
