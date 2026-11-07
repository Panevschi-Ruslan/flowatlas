export default defineEventHandler(async (event) => {
  const body = await readBody<{ item: string }>(event);
  return addLine(body.item);
});
