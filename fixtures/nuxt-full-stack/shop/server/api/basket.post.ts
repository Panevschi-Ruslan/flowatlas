export default defineEventHandler(async (event) => {
  const body = await readBody<{ id: string }>(event);
  return addToBasket(body.id);
});
