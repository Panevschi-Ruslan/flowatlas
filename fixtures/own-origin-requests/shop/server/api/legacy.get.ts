/** The platform fetch on the server has no origin to resolve the path against. */
export default defineEventHandler(async () => {
  const orders = await fetch('/api/orders');
  return orders.json();
});
