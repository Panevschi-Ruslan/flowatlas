import { authed } from './base';
import { NewOrder, OrderId, OrderQuery, Orders } from './schemas';
import { findOrder, findOrders, storeOrder } from './store';

export const listOrders = authed
  .route({ method: 'GET', path: '/orders' })
  .input(OrderQuery)
  .output(Orders)
  .handler(async ({ input }) => findOrders(input.status));

export const getOrder = authed
  .route({ method: 'GET', path: '/orders/{id}' })
  .input(OrderId)
  .errors({ NOT_FOUND: { message: 'no such order' }, RATE_LIMITED: { status: 429 } })
  .handler(async ({ input, errors }) => {
    const order = await findOrder(input.id);
    if (order === undefined) throw errors.NOT_FOUND();
    return order;
  });

export const placeOrder = authed.input(NewOrder).handler(async ({ input }) => storeOrder(input));
