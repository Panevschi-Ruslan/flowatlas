/** Counts every visit: called once, from the root component's setup. */
export const useVisitGuard = () => {
  addRouteMiddleware(async () => {
    await $fetch('/api/visits', { method: 'POST' });
  });
};
