export default defineEventHandler((event) => {
  if (getRequestHeader(event, 'authorization') === undefined && event.path.startsWith('/api/admin')) {
    throw createError({ statusCode: 401 });
  }
});
