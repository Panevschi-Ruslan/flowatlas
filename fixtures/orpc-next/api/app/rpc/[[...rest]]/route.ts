import { RPCHandler } from '@orpc/server/fetch';
import { router } from '../../../src/server/router';

const handler = new RPCHandler(router);

async function handle(request: Request) {
  const { response } = await handler.handle(request, { prefix: '/rpc', context: {} });
  return response ?? new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
