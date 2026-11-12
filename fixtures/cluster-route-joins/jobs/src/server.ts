import express from 'express';

/** Jobs reaches the services from outside the cluster, from this machine, and inside the cluster. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('https://shop.example.test/orders');
  await fetch('https://shop.example.test/catalog/products');
  await fetch('https://shop.example.test/health');
  await fetch('https://api.example.test/inventory/ABC-1');
  await fetch('http://localhost:30080/orders');
  await fetch('http://localhost:8081/products');
  await fetch('http://localhost:4001/stock');
  await fetch('http://stock.shop:8080/stock');
  await fetch('http://billing/invoices');
  await fetch('http://orders:8080/orders');
  res.json({ ok: true });
});

app.listen(3009);
