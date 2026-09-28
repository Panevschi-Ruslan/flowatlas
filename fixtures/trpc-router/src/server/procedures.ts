import { isAdmin, isSignedIn } from './guards';
import { procedure } from './trpc';

export const publicProcedure = procedure;

// The guard is written here, once, and nowhere near any of the ways in it stands
// in front of. Two of them are built on each other, which is the shape that makes
// the reading follow the name it starts from rather than reading one chain.
export const authedProcedure = procedure.use(isSignedIn);

export const adminProcedure = authedProcedure.use(isAdmin);
