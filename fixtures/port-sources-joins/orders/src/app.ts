import express from 'express';

/** Orders listens on 3000, inside the container the compose file publishes as 3001. */
const app = express();

app.get('/orders', (_req, res) => {
  res.json([]);
});

app.listen(3000);
