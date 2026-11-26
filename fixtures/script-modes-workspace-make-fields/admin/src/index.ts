import { Hono } from 'hono';

const app = new Hono();

app.get('/api/reports', (c) => c.json([]));

// Started by `bun run serve` under three modes: the script's, start's and the container's.
Bun.serve({ fetch: app.fetch });
