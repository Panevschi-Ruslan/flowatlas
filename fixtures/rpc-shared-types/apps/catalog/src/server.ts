import { createServer } from 'node:http';
import { OpenAPIHandler } from '@orpc/openapi/node';
import { router } from './router';

const handler = new OpenAPIHandler(router);

createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, { prefix: '/api' });
  if (!matched) res.end();
}).listen(4100);
