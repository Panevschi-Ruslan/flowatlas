import { ofetch } from 'ofetch';

/** A base the settings write is not followed; ofetch imported is the platform fetch underneath. */
export default defineEventHandler(async () => {
  const items = await $fetch('/items', { baseURL: useRuntimeConfig().catalogUrl });
  const orders = await ofetch('/api/orders');
  return { items, orders };
});
