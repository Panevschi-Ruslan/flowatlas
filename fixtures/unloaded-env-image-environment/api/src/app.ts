import express from 'express';

/** Listens on PORT alone; nothing in this repository loads an environment file. */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});
app.listen(process.env.PORT);
