import express from 'express';
import { getConfig, setConfig } from './config';

export async function bootstrap(given: Record<string, any>) {
  await setConfig(given);
  const app = express();
  app.get('/api/archive', (_req, res) => {
    res.json([]);
  });
  app.listen(getConfig().apiOptions.port);
}
