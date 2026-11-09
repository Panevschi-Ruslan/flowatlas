/** Nitro's $fetch hands a path to the server's own routes in process, and its route rules apply. */
export default defineEventHandler(async () => {
  const orders = await $fetch('/api/orders');
  const items = await $fetch('/catalog/items', { method: 'GET' });
  return { orders, items };
});
