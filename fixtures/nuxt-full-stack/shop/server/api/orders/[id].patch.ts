// `renameOrder` is from `server/utils/orders.ts`, which Nitro imports for every server file.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? '';
  const body = await readBody<{ name: string }>(event);
  const order = renameOrder(id, body.name);
  if (order === undefined) {
    throw createError({ statusCode: 404, statusMessage: `no order ${id}` });
  }
  return order;
});
