/**
 * The caller. Each request lands on a route of the uninstalled Express service,
 * and the join is as sure as the route it lands on.
 */
export const listOrders = () => fetch(`${import.meta.env.VITE_API_URL}/api/orders`);

export const placeOrder = (total: number) =>
  fetch(`${import.meta.env.VITE_API_URL}/api/orders`, {
    method: 'POST',
    body: JSON.stringify({ total }),
  });

export const listProducts = () => fetch(`${import.meta.env.VITE_API_URL}/api/catalog/products`);

export const listReviews = () => fetch(`${import.meta.env.VITE_API_URL}/api/catalog/reviews`);

export const adminStats = () => fetch(`${import.meta.env.VITE_API_URL}/api/admin/stats`);
