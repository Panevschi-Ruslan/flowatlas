import express from 'express';

/** Search listens on PORT, or 3000; its container is given 4000. */
const app = express();

app.get('/search', (_req, res) => {
  res.json([]);
});

app.listen(Number(process.env.PORT) || 3000);
