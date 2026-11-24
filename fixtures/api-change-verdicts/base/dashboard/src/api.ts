/** One item, as the dashboard expects `GET /items/:id` to answer it. */
export interface ItemDetail {
  id: string;
  name: string;
  price: number;
}

/** One row of `GET /items`. */
export interface ItemRow {
  id: string;
  name: string;
  thumbnail: string;
}

const base = import.meta.env.VITE_CATALOG_URL;

export async function fetchItem(id: string): Promise<ItemDetail> {
  const response = await fetch(`${base}/items/${id}`);
  return response.json();
}

export async function fetchItems(): Promise<ItemRow[]> {
  const response = await fetch(`${base}/items`);
  return response.json();
}
