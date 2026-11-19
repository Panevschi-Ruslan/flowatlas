import { Hono } from 'hono';

const app = new Hono();

app.get('/api/search', (c) => c.json([]));

// Run by compose under NODE_ENV: ${SEARCH_MODE}, which only the shell running compose gives.
Bun.serve({ fetch: app.fetch });
