import express from 'express';

/** Listens on PORT; the Makefile exports 4700 to every recipe. */
const app = express();

app.get('/levels', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
