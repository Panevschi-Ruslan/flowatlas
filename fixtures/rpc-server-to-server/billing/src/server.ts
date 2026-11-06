import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router';

export const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/trpc', createExpressMiddleware({ router: appRouter }));

app.listen(4000);
