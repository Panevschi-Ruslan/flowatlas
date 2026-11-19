/** Armed by a button: added only once someone presses it. */
export const useLateGuard = () => {
  addRouteMiddleware(
    'late',
    async () => {
      await $fetch('/api/late');
    },
    { global: true },
  );
};
