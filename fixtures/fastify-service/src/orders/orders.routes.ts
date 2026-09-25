import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin, withTenant } from '../middleware/hooks';
import { listOrders } from './orders.controller';
import { orders } from './orders.repository';

/** What a request may carry, where the route says so and only there. */
export interface CreateOrder {
  total: number;
}

const archivePath = (name: string): string => `/${name}/archive`;

/**
 * A plugin, which is how Fastify mounts.
 *
 * The application these routes are declared on is this function's first
 * parameter, and where it is served is decided by whoever registers it and the
 * prefix they pass. Nothing in this file says `/orders`.
 */
export const ordersRoutes: FastifyPluginAsync = async (app) => {
  // Installed on this application, so it covers the routes declared below it
  // and nothing above.
  app.addHook('preHandler', withTenant);

  // A handler named elsewhere and registered by name.
  app.get('/', listOrders);

  // A handler written in the registration.
  app.get('/:orderId', async (request: FastifyRequest, reply: FastifyReply) =>
    reply.send(await orders.byId(request.params['orderId'] as string)),
  );

  // Middleware for one route, which Fastify writes as a key of an options
  // object between the path and the handler rather than as a further argument.
  app.post(
    '/',
    { preHandler: [requireAdmin] },
    async (request: FastifyRequest<CreateOrder>, reply: FastifyReply) => {
      await orders.insert(request.body.total);
      return reply.code(201).send();
    },
  );

  // The object form, which is the one Fastify's own documentation leads with.
  app.route({
    method: 'DELETE',
    url: '/:orderId',
    handler: async (request: FastifyRequest, reply: FastifyReply) => reply.code(204).send(),
  });

  // A path assembled at run time: no route to record, and a row saying so.
  app.get(archivePath('old'), async (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(204).send(),
  );
};
