export default defineNuxtRouteMiddleware(async () => {
  await $fetch('/api/brands');
});
