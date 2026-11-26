/** The basket, used by pages with no import line, as Nuxt imports a composable for them. */
export const useBasket = () => {
  const items = ref<string[]>([]);
  const add = async (id: string): Promise<void> => {
    await $fetch('/api/basket', { method: 'POST', body: { id } });
    items.value.push(id);
  };
  return { items, add };
};
