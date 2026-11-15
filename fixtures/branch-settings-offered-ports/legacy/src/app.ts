import express from 'express';

/** The older orders service everything else reaches through LEGACY_URL. */
const app = express();

app.get('/archive', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(4200);
