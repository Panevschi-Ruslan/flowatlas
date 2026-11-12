export default defineNuxtRouteMiddleware(() => {
  useState('locale', () => 'en');
});
