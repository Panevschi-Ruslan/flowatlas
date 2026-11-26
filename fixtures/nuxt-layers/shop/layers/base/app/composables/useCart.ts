export const useCart = () => {
  const add = (item: string) => $fetch('/api/cart', { method: 'POST', body: { item } });
  return { add };
};
