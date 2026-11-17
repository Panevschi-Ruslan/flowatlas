import express from 'express';

/** The settings the server starts with, before the deployment's are applied. */
const settings = { host: '0.0.0.0', port: 3540 };

function applyDeployment(target: { port: number }) {
  target.port = 4540;
}

async function prepare(config: { port: number }) {
  await applyDeployment(config);
}

prepare(settings);

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.listen(settings.port);
