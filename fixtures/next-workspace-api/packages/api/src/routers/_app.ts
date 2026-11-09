import { router } from '../trpc';
import { shopRouter } from './shop/_router';

/**
 * The root every caller is typed from. The application serves it a feature at
 * a time, so nothing mounts this tree as a whole.
 */
export const appRouter = router({
  shop: shopRouter,
});

export type AppRouter = typeof appRouter;
