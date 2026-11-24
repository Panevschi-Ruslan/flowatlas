import axios from 'axios';

export interface OrderSummary {
  id: string;
  total: number;
  status: string;
}

/** The app's idea of a profile: it expects a `nickname` the API never sends. */
export interface Profile {
  name: string;
  avatarUrl: string;
  nickname?: string;
}

const base = import.meta.env.VITE_SHOP_URL;

/** The body of axios's response, handed back to the query that calls it. */
export const listOrders = (): Promise<OrderSummary[]> => axios.get<OrderSummary[]>(`${base}/api/orders`).then((response) => response.data);

/** The platform's response, its body handed back from `json()`. */
export async function fetchProfile(): Promise<Profile> {
  const response = await fetch(`${base}/api/profile`);
  return response.json();
}

export async function fetchOrder(id: string): Promise<unknown> {
  const response = await fetch(`${base}/api/orders/${id}`);
  return response.json();
}
