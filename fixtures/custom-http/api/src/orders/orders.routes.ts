import { createServer } from 'minihttp';
import { cancelOrder, createOrder, listOrders } from './orders.controller';

/**
 * A server declared in one file and hung under a path in another.
 *
 * Nothing here says where these routes are served; `/orders` is written in
 * `app.ts`, and joining the two is what the description's `mount` row is for.
 */
export const ordersRouter = createServer();

ordersRouter.get('/', listOrders);
ordersRouter.post('/', createOrder);
ordersRouter.post('/:id/cancel', cancelOrder);
