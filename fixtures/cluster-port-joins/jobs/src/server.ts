import express from 'express';

/** Jobs runs in the cluster for some requests and on the machine for others. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('http://orders/orders');
  await fetch('http://stock-api.shop.svc.cluster.local:8080/stock');
  await fetch('http://notify/notices');
  await fetch('http://orders:3000/orders');
  await fetch('http://localhost:4010/search');
  await fetch('http://search:4010/search');
  await fetch('http://localhost:4011/events');
  await fetch('http://localhost:3012/invoices');
  await fetch('http://localhost:3013/entries');
  await fetch('http://localhost:4300/api/cart');
  res.json({ ok: true });
});

app.listen(3009);
