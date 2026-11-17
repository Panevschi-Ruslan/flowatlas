import type { FastifyInstance } from 'fastify';

/** The gateway's routes, as a plugin fastify-cli registers and starts. */
export default async function app(fastify: FastifyInstance) {
  fastify.get('/api/status', async () => ({ ok: true }));
}
