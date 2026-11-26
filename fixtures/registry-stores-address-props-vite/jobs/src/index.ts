import express from 'express';

const app = express();

/** Warms the caches of the front ends run on this machine. */
app.post('/warm', async (_req, res) => {
  await fetch('http://localhost:5173/api/cart');
  await fetch('http://localhost:5173/api/plans');
  await fetch('http://localhost:5173/api/nothing');
  res.sendStatus(204);
});

app.listen(4600);
