const API = import.meta.env.VITE_SHOP_API_URL;

/** The day's report the shop's API builds. */
export const loadReport = async (): Promise<string> => {
  const answer = await fetch(`${API}/api/reports/daily`);
  return answer.json();
};

/** Marks an order ready. */
export async function markReady(orderId: string): Promise<void> {
  await fetch(`${API}/api/orders/status`, { method: 'PATCH', body: JSON.stringify({ orderId, status: 'ready' }) });
}

/** How many items are in stock. */
export const countStock = async (): Promise<number> => {
  const answer = await fetch(`${API}/api/stock`);
  return (await answer.json()).items;
};
