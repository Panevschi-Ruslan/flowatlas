import express from 'express';

/** Orders, started on a port its code writes as a number: a request to it joins `static`. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`orders on ${PORT}`);
});
