import express from 'express';

/** Notify listens on 3000; its chart routes the cluster to 8080. */
const app = express();

app.get('/notices', (_req, res) => {
  res.json([]);
});

app.listen(3000);
