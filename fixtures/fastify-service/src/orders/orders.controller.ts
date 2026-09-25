import type { FastifyReply, FastifyRequest } from 'fastify';
import { orders } from './orders.repository';

/** A handler with a name, registered by that name. */
export const listOrders = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => reply.send(await orders.list());
