import { Hono } from 'hono';

const app = new Hono();

app.get('/api/products', (c) => c.json([]));

// No port written: Bun listens on the BUN_PORT, PORT or NODE_PORT the files it loads give, else 3000.
Bun.serve({ fetch: app.fetch });
