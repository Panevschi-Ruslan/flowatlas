import express from 'express';

/** Notify listens on 3000, but its compose mapping reaches 8080 in the container. */
const app = express();

app.get('/notices', (_req, res) => {
  res.json([]);
});

app.listen(3000);
