import express from 'express';
import { current, settings, type Settings } from './settings';

function apply(target: Settings, overrides: Settings) {
  Object.assign(target, overrides);
}

apply(current(), { port: 4430 });

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.listen(settings.port);
