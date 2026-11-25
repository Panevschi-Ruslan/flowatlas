import axios from 'axios';

/** One item, as the dashboard expects `GET /items/:id` to answer it. */
export interface ItemDetail {
  id: string;
  name: string;
  status: 'draft' | 'live';
}

export interface ItemRow {
  id: string;
  name: string;
}

const base = import.meta.env.VITE_CATALOG_URL;

export async function fetchItem(id: string): Promise<ItemDetail> {
  const response = await axios.get<ItemDetail>(`${base}/items/${id}`);
  return response.data;
}

/** Sends the page as a query key. */
export async function fetchPage(page: string): Promise<ItemRow[]> {
  const response = await axios.get<ItemRow[]>(`${base}/items`, { params: { page } });
  return response.data;
}

/** Sends the words looked for, and no tenant header. */
export async function searchItems(q: string): Promise<ItemRow[]> {
  const response = await axios.get<ItemRow[]>(`${base}/items/search`, { params: { q }, headers: { accept: 'application/json' } });
  return response.data;
}
