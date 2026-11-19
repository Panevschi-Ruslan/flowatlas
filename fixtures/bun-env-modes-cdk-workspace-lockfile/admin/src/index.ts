import { Hono } from 'hono';

const app = new Hono();

app.get('/api/reports', (c) => c.json([]));

Bun.serve({ fetch: app.fetch });
