import express from 'express';

/** Starts the search server; a caller that names no port gets 3200. */
export function start(port = 3200) {
  const app = express();
  app.get('/api/search', (_req, res) => {
    res.json({ hits: [] });
  });
  app.listen(port);
}

/** The same server for the admin tools, given its options as an object. */
export function startAdmin({ port = 3201 }: { port?: number } = {}) {
  const app = express();
  app.get('/api/reindex', (_req, res) => {
    res.status(202).end();
  });
  app.listen(port);
}
