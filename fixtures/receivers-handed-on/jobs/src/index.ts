import express from 'express';

const app = express();

/** The products under a version the caller hands, written straight after the host. */
export async function readProducts(version: string) {
  const res = await fetch(`https://shop.example.test${version}/products`);
  return res.json();
}

export async function productsV1() {
  return readProducts('/v1');
}

/** The local health check, at a port the caller hands. */
export async function readHealth(port: string) {
  const res = await fetch(`http://localhost${port}/health`);
  return res.json();
}

export async function healthHere() {
  return readHealth(':4600');
}

app.post('/sync', async (_req, res) => {
  res.json({ products: await productsV1(), health: await healthHere() });
});

app.listen(4800);
