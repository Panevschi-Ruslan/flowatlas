import { findOrder } from '../../utils/orders';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? '';
  const order = findOrder(id);
  if (order === undefined) {
    throw createError({ statusCode: 404, statusMessage: `no order ${id}` });
  }
  return order;
});
