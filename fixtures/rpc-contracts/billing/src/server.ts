import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';

export const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

/** Served at /trpc: the `use` call the middleware is handed to says so. */
const trpc = createExpressMiddleware({ router: appRouter });

app.use('/trpc', trpc);

app.listen(4000);
