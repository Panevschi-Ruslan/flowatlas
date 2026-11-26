import express from 'express';

/** Audit listens on PORT, which the script gives its container as 3000. */
const app = express();

app.get('/events', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT);
