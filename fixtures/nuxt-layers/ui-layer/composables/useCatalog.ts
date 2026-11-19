export const useCatalog = () => {
  const load = () => $fetch('/api/products');
  return { load };
};
