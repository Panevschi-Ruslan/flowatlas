import { Hono } from 'hono';

const app = new Hono();

app.get('/api/products', (c) => c.json([]));

// No port: Bun listens where the files of the mode each script runs it in say.
Bun.serve({ fetch: app.fetch });
