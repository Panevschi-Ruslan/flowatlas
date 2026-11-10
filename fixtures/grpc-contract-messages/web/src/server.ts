import express from 'express';
import { count, quote, release, reserve } from './clients';

const app = express();
app.use(express.json());

app.post('/reservations', async (req, res) => {
  res.json(await reserve(req.body.sku, req.body.quantity));
});

app.delete('/reservations/:id', async (req, res) => {
  res.json(await release(req.params.id));
});

app.get('/stock/:sku', async (req, res) => {
  res.json(await count(req.params.sku));
});

app.post('/quotes', async (req, res) => {
  res.json(await quote(req.body.skus, req.body.couponCode));
});

app.listen(8080);
