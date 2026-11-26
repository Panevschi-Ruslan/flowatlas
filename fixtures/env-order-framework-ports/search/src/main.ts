import express from 'express';
import { Settings } from './settings';

const settings = new Settings();
settings.load({ port: 4200 });

const app = express();
app.get('/api/search', (_req, res) => {
  res.json({ hits: [] });
});
app.listen(settings.get().port);
