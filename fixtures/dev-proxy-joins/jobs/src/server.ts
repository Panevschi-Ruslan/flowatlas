import express from 'express';

/** Jobs calls orders through the web front end's dev server, as a developer's script would. */
const app = express();

app.post('/jobs/sync', async (_req, res) => {
  await fetch('http://localhost:5180/api/orders');
  await fetch('http://localhost:5180/rates/today');
  res.json({ ok: true });
});

app.listen(3009);
