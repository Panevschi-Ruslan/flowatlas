import { Hono } from 'hono';

const app = new Hono();

app.get('/api/summaries', (c) => c.json([]));

// Run by the container compose builds from this directory, under its BUN_ENV.
Bun.serve({ fetch: app.fetch });
