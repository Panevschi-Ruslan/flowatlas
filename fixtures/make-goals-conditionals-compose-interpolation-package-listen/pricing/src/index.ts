import { Hono } from 'hono';

const app = new Hono();

app.get('/api/prices', (c) => c.json([]));

// Run by compose with the env_file pricing/compose.env.
Bun.serve({ fetch: app.fetch });
