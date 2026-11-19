import express from 'express';

const app = express();

/** The items, under a public address whose path serves nothing: the one service serving the request's own path. */
export async function readItems() {
  const res = await fetch(`${process.env.SHOP_URL}/items`);
  return res.json();
}

/** The shop's health, a path two services serve: a row naming both. */
export async function readHealth() {
  const res = await fetch(`${process.env.SHOP_URL}/health`);
  return res.json();
}

app.post('/sync', async (_req, res) => {
  res.json({ items: await readItems(), health: await readHealth() });
});

app.listen(4800);
