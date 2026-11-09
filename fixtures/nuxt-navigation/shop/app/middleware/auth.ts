/** Sends a visitor with no session to the login page, and stops one asking for the back office. */
export default defineNuxtRouteMiddleware((to) => {
  const session = useCookie('session');
  if (to.path.startsWith('/admin') && !session.value) return abortNavigation();
  if (!session.value) return navigateTo('/login');
});
