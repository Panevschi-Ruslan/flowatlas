import { PrismaClient } from '@prisma/client';

/**
 * A client this file constructs, from the package rather than a generated path.
 * No schema is readable from here, so the model is named as the call writes it.
 */
const cached = (globalThis as { client?: PrismaClient }).client;
const client = cached ?? new PrismaClient();

export const oldest = (): Promise<unknown> => client.order.findFirst();

/**
 * Named `prisma` and shaped like a client, and not one: nothing traces it to a
 * client, so it is not read. A name is not evidence (R112).
 */
const prisma = { order: { findMany: async (): Promise<unknown[]> => [] } };

export const fake = (): Promise<unknown[]> => prisma.order.findMany();
