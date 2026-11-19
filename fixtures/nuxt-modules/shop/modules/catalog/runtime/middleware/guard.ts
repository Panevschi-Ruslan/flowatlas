export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/catalog/closed') return navigateTo('/catalog');
});
