export interface Order {
  id: string;
  status: string;
}

const base = import.meta.env.VITE_SHOP_URL;

/** The shop's order, as the order screen asks for it. */
export async function fetchOrder(id: string): Promise<Order> {
  const response = await fetch(`${base}/api/orders/${id}`);
  return response.json();
}
