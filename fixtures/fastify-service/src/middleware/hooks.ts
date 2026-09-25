import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The guard equivalent, installed as a hook rather than as middleware.
 *
 * Fastify calls it a hook and names the moment it runs, which is why the first
 * argument of `addHook` is a lifecycle name and not a path. Everything else
 * about it is the same fact: something in front of a route that can refuse a
 * request.
 */
export const authenticate = (request: FastifyRequest, reply: FastifyReply): unknown =>
  request.headers['authorization'] === undefined ? reply.code(401).send() : undefined;

export const withTenant = (request: FastifyRequest, reply: FastifyReply): unknown =>
  request.headers['x-tenant'] === undefined ? reply.code(400).send() : undefined;

/** Written into one route's options rather than installed on an application. */
export const requireAdmin = (request: FastifyRequest, reply: FastifyReply): unknown =>
  request.headers['x-role'] === 'admin' ? undefined : reply.code(403).send();
