import express from 'express';

/**
 * The API listens wherever `PORT` says, and on 3000 where nothing sets it:
 * the fallback the code writes, which is also the port the shop's framework
 * assumes. Nothing in the repository sets `PORT`.
 */
const app = express();

app.get('/items', (_req, res) => {
  res.json([]);
});

app.listen(process.env.PORT ?? 3000);
