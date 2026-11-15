import express from 'express';

const app = express();
app.use(express.json());

app.get('/items', (_req, res) => {
  res.json([]);
});

app.get('/items/:id/reviews', (_req, res) => {
  res.json([]);
});

app.post('/cart', (req, res) => {
  res.status(201).json({ item: req.body.item, quantity: req.body.quantity });
});

app.get('/cart/total', (_req, res) => {
  res.json({ total: 0 });
});

app.put('/cart/coupon', (req, res) => {
  res.json({ code: req.body.code });
});

app.post('/orders', (req, res) => {
  res.status(201).json({ cart: req.body.cart });
});

app.get('/stock', (_req, res) => {
  res.json([]);
});

app.listen(4710);
