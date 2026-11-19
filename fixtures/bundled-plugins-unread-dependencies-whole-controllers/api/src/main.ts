import express from 'express';

interface Settings {
  host: string;
  port?: number;
}

/** The settings the server starts with; the port is written by the deployment. */
const settings: Settings = { host: '0.0.0.0' };

function applyPort(target: Settings, port: number) {
  target.port = port;
}

function configure(config: Settings, port: number) {
  applyPort(config, port);
}

function deploy(config: Settings, port: number) {
  configure(config, port);
}

deploy(settings, 4610);

/** A preview deployment configures settings of its own on another port. */
export function preview() {
  const own: Settings = { host: '127.0.0.1' };
  configure(own, 4699);
  deploy({ host: '127.0.0.1' }, 4698);
  return own;
}

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.listen(settings.port);
