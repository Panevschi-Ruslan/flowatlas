export default defineEventHandler(async (event) => {
  const body = await readBody<{ item: string }>(event);
  return addLine(slugify(body.item));
});
