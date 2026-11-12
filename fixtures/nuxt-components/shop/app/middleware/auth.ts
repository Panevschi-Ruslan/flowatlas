export default defineNuxtRouteMiddleware(async () => {
  const session = await $fetch('/api/session');
  if (session === null) return navigateTo('/');
});
