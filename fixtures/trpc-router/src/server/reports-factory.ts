import { publicProcedure } from './procedures';
import { router } from './trpc';

/**
 * A tree built by a call, which is the uncovered case.
 *
 * Nothing here is wrong; it is simply not readable. The mount below is handed the
 * value a call produced, so there is no name to follow to a tree, and the key the
 * one member is written under is computed, so it has no address either. Both are
 * rows rather than silence, and that is the whole point of the file.
 */
export const reportsRouterFor = (scope: string) =>
  router({
    [scope]: publicProcedure.query(() => [{ scope }]),
  });
