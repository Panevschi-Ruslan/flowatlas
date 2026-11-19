import express from 'express';

/** Listens on PORT; compose gives it `- PORT`, valued from the project .env. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
