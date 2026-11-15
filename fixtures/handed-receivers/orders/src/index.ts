import express from 'express';

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(4700);
