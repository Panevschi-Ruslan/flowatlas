import express from 'express';
import { addToCart, checkout, getCart, listProducts, quote, record } from './clients';

const app = express();
app.use(express.json());

app.get('/cart/:userId', async (req, res) => {
  res.json(await getCart(req.params.userId));
});

app.post('/cart/:userId/items', async (req, res) => {
  await addToCart(req.params.userId, req.body.productId);
  res.sendStatus(204);
});

app.post('/checkout/:userId', async (req, res) => {
  const receipt = await checkout(req.params.userId, req.body.amount);
  record(req.params.userId);
  res.json(receipt);
});

app.get('/products', async (_req, res) => {
  res.json(await listProducts());
});

app.get('/shipping/:zip', async (req, res) => {
  res.json(await quote(req.params.zip));
});

app.listen(8080);
