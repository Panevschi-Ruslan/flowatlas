import express from 'express';

/** Listens on 3000, and reads the catalog's address from CATALOG_URL. */
const app = express();

app.get('/invoices', async (_req, res) => {
  const products = await fetch(`${process.env.CATALOG_URL}/products`);
  res.json(await products.json());
});

app.listen(3000);
