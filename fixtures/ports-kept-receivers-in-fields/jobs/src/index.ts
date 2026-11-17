import express from 'express';

const app = express();

/** Ports a class and a module keep as numbers. */
class Ports {
  static readonly stock = 4700;

  static get catalog(): number {
    return 4600;
  }
}

const CATALOG_PORT = 4600;

/** A port the caller hands, after the host's colon. */
export async function readHealth(port: number) {
  const res = await fetch(`http://localhost:${port}/health`);
  return res.json();
}

export const stockHealth = () => readHealth(Ports.stock);

export const catalogHealth = () => readHealth(Ports.catalog);

export const catalogHealthAgain = () => readHealth(CATALOG_PORT);

/** Written in place, in a port's place. */
export async function stockLevels() {
  const res = await fetch(`http://localhost:${Ports.stock}/levels`);
  return res.json();
}

/** A number written straight after a host with no colon before it: no port. */
export async function probe(port: number) {
  const res = await fetch(`http://localhost${port}/health`);
  return res.ok;
}

export const probeCatalog = () => probe(4600);

app.post('/sync', async (_req, res) => {
  res.json({
    stock: await stockHealth(),
    catalog: await catalogHealth(),
    again: await catalogHealthAgain(),
    levels: await stockLevels(),
    probe: await probeCatalog(),
  });
});

app.listen(4800);
