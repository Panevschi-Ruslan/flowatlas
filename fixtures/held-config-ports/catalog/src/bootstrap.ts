import express from 'express';
import { getConfig, setConfig } from './config/holder';

export async function bootstrap(given: Record<string, any>) {
  setConfig(given);
  const app = express();
  app.get('/api/items', (_req, res) => {
    res.json([]);
  });
  const { hostname, port } = getConfig().apiOptions;
  app.listen(port, hostname);
  return app;
}
