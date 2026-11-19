import express from 'express';

/** Jobs listens on PORT; the container `docker run` starts is given 3000. */
const app = express();

app.post('/jobs/run', async (_req, res) => {
  await fetch('http://orders:3000/orders');
  await fetch('http://search:4000/search');
  await fetch('http://localhost:5174/api/basket');
  res.json({ ok: true });
});

app.listen(process.env.PORT);
