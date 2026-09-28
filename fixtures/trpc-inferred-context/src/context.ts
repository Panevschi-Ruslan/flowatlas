import { prisma } from './db';

export interface InnerContext {
  prisma: typeof prisma;
  userId?: string;
}

/**
 * What every procedure is handed as `ctx`. The type is written here, once, and
 * nowhere near a single procedure: tRPC carries it to them through
 * `initTRPC.context<typeof createContextInner>()`.
 */
export async function createContextInner(): Promise<InnerContext> {
  return { prisma };
}
