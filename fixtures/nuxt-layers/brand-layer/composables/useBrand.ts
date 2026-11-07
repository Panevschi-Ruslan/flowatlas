export const useBrand = () => ({
  refresh: () => $fetch('/api/brand'),
});
