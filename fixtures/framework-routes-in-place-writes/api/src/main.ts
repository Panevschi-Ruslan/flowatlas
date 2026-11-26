import express from 'express';
import { config } from './config';

Object.assign(config.server, { port: 4330 });

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.listen(config.server.port);
