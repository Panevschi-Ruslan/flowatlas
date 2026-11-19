import express from 'express';

const app = express();

app.get('/stock/:sku', (req, res) => {
  res.json({ sku: req.params.sku, count: 0 });
});

/** Stock's server listens wherever whoever starts it says. */
export const start = (port: number) => app.listen(port, () => console.log(`stock on ${port}`));
