import express from 'express';

/** Listens on PORT; its included compose file gives it the port the project .env sets. */
const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT ?? 3000);
