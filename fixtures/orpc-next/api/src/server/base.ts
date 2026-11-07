import { ORPCError, os } from '@orpc/server';

export interface Context {
  user?: { id: string };
}

/** Every procedure starts here: the context, and the failure each may answer with. */
export const base = os.$context<Context>().errors({ UNAUTHORIZED: { message: 'sign in first' } });

/** A guard installed once on a starting point, and inherited by every chain begun from it. */
export const requireUser = async ({ context, next }: { context: Context; next: () => Promise<unknown> }) => {
  if (context.user === undefined) throw new ORPCError('UNAUTHORIZED');
  return next();
};

export const authed = base.use(requireUser);

/** Installed by the router in front of everything under it. */
export const audit = async ({ next }: { next: () => Promise<unknown> }) => next();
