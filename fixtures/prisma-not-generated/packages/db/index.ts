import { PrismaClient } from './generated/prisma/client';

/**
 * The repository's Prisma wrapper, written the way a real one is. The client is
 * imported from `./generated/prisma`, which `schema.prisma` names as its
 * generator's output and which does not exist until `prisma generate` runs - the
 * state of every clone installed with `--ignore-scripts`.
 */
const base = new PrismaClient();

export const prisma: PrismaClient = base.$extends({}) as unknown as PrismaClient;

export type { PrismaClient };

export default prisma;
