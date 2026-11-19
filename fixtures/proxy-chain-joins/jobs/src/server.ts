import express from 'express';

/** Jobs asks the kiosk's dev server, which forwards through two more servers. */
const app = express();

app.post('/jobs/sync', async (_req, res) => {
  await fetch('http://localhost:5190/shop/api/orders/7');
  res.json({ ok: true });
});

app.listen(3009);
