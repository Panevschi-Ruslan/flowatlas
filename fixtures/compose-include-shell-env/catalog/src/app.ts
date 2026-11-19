import express from 'express';

/** Listens on PORT, which its included compose file gives as 4000. */
const app = express();

app.get('/products', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT);
