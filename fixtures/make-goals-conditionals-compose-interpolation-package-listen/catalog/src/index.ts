import { Hono } from 'hono';

const app = new Hono();

app.get('/api/products', (c) => c.json([]));

// Run by compose under NODE_ENV: ${CATALOG_MODE:-development}; the project's .env sets CATALOG_MODE.
Bun.serve({ fetch: app.fetch });
