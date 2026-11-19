import express from 'express';

/**
 * The API listens wherever `PORT` says, with no fallback in the code. Its
 * example environment file offers 3000, the port the shop's framework
 * assumes too: an offer, not what a run is given.
 */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT);
