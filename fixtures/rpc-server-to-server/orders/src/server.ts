import express from 'express';
import { RPCHandler } from '@orpc/server/node';
import { router } from './router';

const handler = new RPCHandler(router);

export const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/rpc', async (req, res, next) => {
  const { matched } = await handler.handle(req, res, { prefix: '/rpc' });
  if (!matched) next();
});

app.listen(3000);
