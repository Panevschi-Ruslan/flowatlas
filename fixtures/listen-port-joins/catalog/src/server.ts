import { serve } from '@hono/node-server';
import { Hono } from 'hono';

/** The catalog, a Hono application started by `@hono/node-server` on 3003. */
const app = new Hono();

app.get('/products', (c) => c.json([]));

serve({ fetch: app.fetch, port: 3003 });
