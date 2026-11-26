import { Hono } from 'hono';

const app = new Hono();

app.get('/api/alerts', (c) => c.json([]));

// Its image links Bun in place of node.
Bun.serve({ fetch: app.fetch });
