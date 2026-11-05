import express from 'express';
import { OpenAPIHandler } from '@orpc/openapi/node';
import { router } from './router';

const handler = new OpenAPIHandler(router);

export const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api', async (req, res, next) => {
  const { matched } = await handler.handle(req, res, { prefix: '/api', context: { staff: true } });
  if (!matched) next();
});

app.listen(3000);
