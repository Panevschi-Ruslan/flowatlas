/** The requests the order page makes, imported through `~/composables`. */
export const useOrderApi = () => {
  const rename = async (id: string, name: string): Promise<void> => {
    await $fetch(`/api/orders/${id}`, { method: 'PATCH', body: { name } });
  };
  return { rename };
};
