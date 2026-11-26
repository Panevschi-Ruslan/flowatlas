import express from 'express';

/** Search listens on 3000; its Makefile publishes it as 4010. */
const app = express();

app.get('/search', (_req, res) => {
  res.json([]);
});

app.listen(3000);
