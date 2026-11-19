import { procedure } from '../../../trpc';

/**
 * A way in written on its own beside the orders tree and never added to it
 * (P270): the tree declares its own members inline, and nothing names this one.
 */
export const orderTotals = procedure.query(() => ({ count: 0, sum: 0 }));
