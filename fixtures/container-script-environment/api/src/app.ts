import express from 'express';

/** Listens on PORT; started by its bin, shop-api, which scripts/run-api.sh runs after exporting 4800. */
const app = express();

app.get('/carts', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
