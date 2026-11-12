export default defineNuxtRouteMiddleware(async (to) => {
  await $fetch('/api/visits', { method: 'POST', body: { path: to.path } });
});
