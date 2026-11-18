import express from 'express';

/** Listens on PORT; its bin points at what a build writes. */
const app = express();

app.get('/users', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
