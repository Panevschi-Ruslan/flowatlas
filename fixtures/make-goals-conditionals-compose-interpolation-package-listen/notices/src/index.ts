import { Hono } from 'hono';

const app = new Hono();

app.get('/api/notices', (c) => c.json([]));

// Its image is Bun's own, whose node may or may not be Bun.
Bun.serve({ fetch: app.fetch });
