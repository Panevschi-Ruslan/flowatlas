export default defineEventHandler((event) => {
  stampRequest(event.path);
  return [{ id: slugify('First order') }];
});
