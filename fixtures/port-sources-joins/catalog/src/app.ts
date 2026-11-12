import express from 'express';

import { config } from './config';

const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});

app.listen(config.port);
