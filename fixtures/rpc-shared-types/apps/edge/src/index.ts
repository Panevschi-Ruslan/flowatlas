import { Hono } from 'hono';
import { trpcServer } from '@hono/trpc-server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { ledgerRouter } from './router';

const app = new Hono();

// Hono's middleware, answering under its endpoint.
app.use('/rpc/*', trpcServer({ router: ledgerRouter, endpoint: '/rpc' }));

// The fetch adapter written inside a Hono handler, answering under its own endpoint.
app.all('/legacy/*', (c) => fetchRequestHandler({ endpoint: '/legacy', req: (c as any).req.raw, router: ledgerRouter }));

export default app;
