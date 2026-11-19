import { ref } from 'vue';

/** The order list, and the way to fetch it again. */
export const useOrders = () => {
  const orders = ref<Array<{ id: string; name: string }>>([]);
  const load = async (): Promise<void> => {
    const answer = await fetch(`${import.meta.env.VITE_API_URL}/orders`);
    orders.value = await answer.json();
  };
  return { orders, load };
};
