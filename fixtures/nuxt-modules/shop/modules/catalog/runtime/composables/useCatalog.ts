export const useCatalog = () => {
  const load = () => $fetch('/api/catalog');
  return { load };
};
