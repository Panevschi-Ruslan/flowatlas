import express from 'express';

/** Jobs reaches the services inside the cluster, and stock through its way in. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('http://orders:8080/orders');
  await fetch('http://payments:8082/payments', { method: 'POST' });
  await fetch('http://shop-stock:8080/stock');
  await fetch('https://stock.example.test/stock');
  res.json({ ok: true });
});

app.listen(3009);
