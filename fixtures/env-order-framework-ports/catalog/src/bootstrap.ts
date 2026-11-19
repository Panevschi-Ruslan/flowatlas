import express from 'express';
import { getConfig, setConfig } from './config/holder';
import { applyPlugins } from './plugins';

export async function bootstrap(given: Record<string, any>) {
  await setConfig(given);
  let config = getConfig();
  config = await applyPlugins(config);
  const app = express();
  app.get('/api/items', (_req, res) => {
    res.json([]);
  });
  const { hostname, port } = config.apiOptions;
  app.listen(port, hostname);
}
