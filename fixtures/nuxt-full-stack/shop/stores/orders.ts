import { defineStore } from 'pinia';

export const useOrdersStore = defineStore('orders', () => {
  const removed = ref(0);
  const remove = async (id: string): Promise<void> => {
    await $fetch(`/api/orders/${id}`, { method: 'DELETE' });
    removed.value += 1;
  };
  return { removed, remove };
});
