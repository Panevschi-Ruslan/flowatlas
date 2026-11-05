import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { router } from '../../../src/server/router';

const handler = new OpenAPIHandler(router);

async function handle(request: Request) {
  const { response } = await handler.handle(request, { prefix: '/api', context: {} });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
