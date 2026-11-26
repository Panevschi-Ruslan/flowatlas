import 'dotenv/config';
import express from 'express';

const app = express();

app.get('/api/orders', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
