/** Empties the basket. Named only by a template, which Nuxt imports it for. */
export const clearBasket = async (): Promise<void> => {
  await $fetch('/api/basket', { method: 'DELETE' });
};
