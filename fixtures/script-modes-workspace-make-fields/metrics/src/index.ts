import { Hono } from 'hono';

const app = new Hono();

app.get('/api/counters', (c) => c.json([]));

// bunfig.toml writes env = false: no file Bun loads of its own gives the port.
Bun.serve({ fetch: app.fetch });
