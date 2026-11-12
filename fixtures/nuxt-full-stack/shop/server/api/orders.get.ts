import { listOrders } from '../utils/orders';

export default defineEventHandler((event) => {
  const query = getQuery(event);
  return listOrders().slice(0, Number(query.limit ?? 50));
});
