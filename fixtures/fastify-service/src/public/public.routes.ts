import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { orders } from '../orders/orders.repository';

/**
 * Registered before the hook that refuses a request, so nothing is in front of
 * these — which is what the route audit reports about the one that reads
 * stored data.
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send({ status: 'ok' }),
  );

  app.get('/summary', async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send({ orders: await orders.list() }),
  );
};
