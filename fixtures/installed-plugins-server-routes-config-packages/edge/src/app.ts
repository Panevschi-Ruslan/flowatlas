import type { FastifyInstance } from 'fastify';

/** The edge's routes, as a plugin fastify-cli registers and starts. */
export default async function app(fastify: FastifyInstance) {
  fastify.get('/api/edge', async () => ({ ok: true }));
}
