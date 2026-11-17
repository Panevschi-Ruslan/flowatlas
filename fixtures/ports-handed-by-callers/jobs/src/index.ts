import express from 'express';

const app = express();

/** A port the caller hands, after the host's colon. */
export const readHealth = function (port: number) {
  return fetch(`http://localhost:${port}/health`).then((res) => res.json());
};

// Callers written as an arrow and a function expression held by a const.
export const catalogHealth = () => readHealth(4600);

export const stockHealth = function () {
  return readHealth(4700);
};

/** A path the caller hands, written straight after the host. */
export async function readProducts(version: string) {
  const res = await fetch(`http://localhost:4600${version}/products`);
  return res.json();
}

export const productsV1 = () => readProducts('/v1');

/** A path the caller hands, added to the host. */
export async function readStock(path: string) {
  const res = await fetch('http://localhost:4700' + path);
  return res.json();
}

export const stockLevels = async () => readStock('/levels');

/** A port written straight after the host, a caller handing one a class keeps. */
export async function ping(port: string) {
  const res = await fetch(`http://localhost${port}/health`);
  return res.ok;
}

class Ports {
  static readonly stock = ':4700';
}

export const pingStock = () => ping(Ports.stock);

app.post('/sync', async (_req, res) => {
  res.json({
    catalog: await catalogHealth(),
    stock: await stockHealth(),
    products: await productsV1(),
    levels: await stockLevels(),
    ping: await pingStock(),
  });
});

app.listen(4800);
