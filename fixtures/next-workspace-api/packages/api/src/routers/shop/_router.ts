import { router } from '../../trpc';
import { catalogRouter } from '../catalog/_router';
import { ordersRouter } from '../orders/_router';

/** Every feature's tree under one key; no file serves this one itself. */
export const shopRouter = router({
  orders: ordersRouter,
  catalog: catalogRouter,
});
