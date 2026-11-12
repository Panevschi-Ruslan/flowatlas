import { dropOrder } from '../../utils/orders';

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id') ?? '';
  if (!dropOrder(id)) throw createError({ statusCode: 404 });
  return { removed: id };
});
