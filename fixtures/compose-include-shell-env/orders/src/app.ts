import express from 'express';

/** Listens on PORT alone: its container is given it by the service it extends. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT);
