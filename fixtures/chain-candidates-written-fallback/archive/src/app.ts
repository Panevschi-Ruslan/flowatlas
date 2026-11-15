import express from 'express';

/** The export service, which the deployment also points LEGACY_URL at. */
const app = express();

app.get('/exports', (_req, res) => {
  res.json([]);
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4300);
