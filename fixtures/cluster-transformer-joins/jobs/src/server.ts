import express from 'express';

/** Jobs reaches the services inside the cluster by the names their manifests give them. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('http://shop-orders:8080/orders');
  await fetch('http://stock:8443/stock');
  await fetch('http://payments:8082/payments', { method: 'POST' });
  res.json({ ok: true });
});

app.listen(3009);
