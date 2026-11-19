import express from 'express';

const app = express();

app.get('/api/stock', (_req, res) => {
  res.json([]);
});

app.listen(process.env.INVENTORY_PORT ?? 3000);
