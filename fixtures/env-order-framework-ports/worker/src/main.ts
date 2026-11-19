import express from 'express';
import getPort from 'get-port';

export async function start() {
  let port = 3800;
  port = await getPort({ port });
  const app = express();
  app.get('/api/tasks', (_req, res) => {
    res.json([]);
  });
  app.listen(port);
}

void start();
