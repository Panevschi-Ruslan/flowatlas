/**
 * The caller. Each request lands on a route of the uninstalled Express service,
 * and the join is as sure as the route it lands on.
 */
const base = import.meta.env.VITE_API_URL;

export const listOrders = () => fetch(`${base}/api/orders`);

export const placeOrder = (total: number) =>
  fetch(`${base}/api/orders`, { method: 'POST', body: JSON.stringify({ total }) });

export const listProducts = () => fetch(`${base}/api/catalog/products`);

export const listPlugins = () => fetch(`${base}/api/plugins/list`);

export const jobsHealth = () => fetch(`${import.meta.env.VITE_JOBS_URL}/jobs/health`);

export const status = () => fetch(`${base}/api/status`);

export const reports = () => fetch(`${base}/api/reports`);
