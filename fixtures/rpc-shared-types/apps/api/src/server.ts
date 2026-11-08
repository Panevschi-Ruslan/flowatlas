import fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from '@shop/router';

/**
 * Serves the shared orders tree through Fastify's plugin, handed to
 * `register` with its prefix: every procedure is answered under /trpc.
 */
const server = fastify();

server.register(fastifyTRPCPlugin, { prefix: '/trpc', trpcOptions: { router: appRouter } });

server.listen({ port: 4000 });
