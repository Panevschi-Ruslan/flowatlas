import { Hono } from 'hono';

const app = new Hono();

app.get('/api/tickets', (c) => c.json([]));

// dev runs serve with bun --bun, so the node serve runs is Bun.
Bun.serve({ fetch: app.fetch });
