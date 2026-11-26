export default defineNuxtPlugin(() => {
  addRouteMiddleware('reports-only', async () => {
    await $fetch('/api/reports/access');
  });
});
