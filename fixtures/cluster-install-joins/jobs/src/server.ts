import express from 'express';

/** Jobs reaches the services inside the cluster, through a way in, and from this machine. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('http://shop-orders:8080/orders');
  await fetch('http://shop-catalog:8083/catalog/products');
  await fetch('http://stock:8080/stock');
  await fetch('http://stock-admin:9090/stock');
  await fetch('http://catalog-preview-catalog:9093/catalog/products');
  await fetch('http://localhost:8085/orders');
  await fetch('https://admin.example.test/orders');
  await fetch('https://other.example.test/catalog/products');
  res.json({ ok: true });
});

app.listen(3009);
