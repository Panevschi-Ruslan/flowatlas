import ElementPlus from 'element-plus';

const audit = defineNuxtRouteMiddleware(async () => {
  await $fetch('/api/audit', { method: 'POST' });
});

export default defineNuxtPlugin((nuxtApp) => {
  // A library of components: its tags are its own, with no row.
  nuxtApp.vueApp.use(ElementPlus);
  // A named middleware a page names, added when the application starts.
  addRouteMiddleware('signed-in', async () => {
    await $fetch('/api/session');
  });
  // In front of every page: a function alone, and one marked global.
  addRouteMiddleware(async () => {
    await $fetch('/api/visits', { method: 'POST' });
  });
  addRouteMiddleware('audit', audit, { global: true });
  // A name written as code: a row.
  addRouteMiddleware(useRuntimeConfig().public.guardName, () => undefined);
});
